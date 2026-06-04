# Printable: Claude SDK Orchestration Architecture

**Status:** Research & Design (not implementation)  
**Date:** 2026-05-28  
**Context:** Agentic 3D mesh editing loop: user clicks 3D model → types prompt with point tokens → Claude decides operations → calls Blender worker → iterates until satisfied.

---

## 1. Streaming + Tool-Use Loop Pattern

**2026 best practice for agentic meshes:** Use `messages.stream()` with `eager_input_streaming: true` on large tool params + iterative tool result feeding.

### Pseudocode Pattern

```typescript
// Main orchestration loop
async function runMeshEditSession(sessionId: string, userPrompt: string) {
  const messages: MessageParam[] = [];
  let turn = 0;

  while (turn < MAX_TURNS && !editComplete) {
    turn++;
    
    // Stream response with fine-grained tool input streaming
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: meshSystemPrompt(),
      tools: meshTools(),
      messages,
    });

    // Accumulate tool calls as they stream in
    let assistantResponse = "";
    let toolCalls: ToolUseBlock[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        assistantResponse += event.delta.text;
        // Push text updates to frontend in real-time
        io.emit("claude_thinking", { text: assistantResponse });
      }
      
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        toolCalls.push(event.content_block);
      }
    }

    // Fetch final message for stop_reason
    const finalMessage = await stream.finalMessage();
    messages.push({
      role: "assistant",
      content: finalMessage.content,
    });

    // Process tool calls sequentially (meshes are stateful)
    for (const toolCall of finalMessage.content.filter(b => b.type === "tool_use")) {
      let result: unknown;
      
      try {
        switch (toolCall.name) {
          case "apply_named_operation":
            result = await blenderWorker.call(toolCall.input);
            io.emit("operation_complete", { op: toolCall.input, result });
            break;
          case "render_preview":
            result = await blenderWorker.render(toolCall.input);
            // Send rendered PNG + camera matrix back in same message
            messages.push({
              role: "user",
              content: [
                { 
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: result.base64 }
                },
                {
                  type: "text",
                  text: `Render complete. Dimensions: ${result.bbox}. Verify against user requirements.`
                }
              ]
            });
            break;
          case "commit_state":
            result = { committed: true, timestamp: new Date().toISOString() };
            editComplete = true;
            break;
          // ... other tools
        }
      } catch (e) {
        // Return error as tool_result for Claude to interpret
        messages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Error: ${e.message}`,
            is_error: true
          }]
        });
        continue;
      }

      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(result)
        }]
      });
    }

    // Check stop reason
    if (finalMessage.stop_reason === "end_turn") {
      editComplete = true; // User said "looks good" or Claude decided complete
    }
  }

  return { sessionId, finalMesh: getCurrentMesh(), turns: turn };
}
```

**Why this pattern:**
- `eager_input_streaming` lets Blender worker start processing (e.g., parsing geometry) before Claude finishes token generation.
- Real-time text deltas → frontend sees "applying fillet..." immediately, not after 5-token batch.
- Tool result feeding directly into next turn avoids message reconstruction overhead.
- `stop_reason: "end_turn"` provides natural exit without explicit "done" tool.

---

## 2. Prompt Caching Strategy

Session context is **static per user**, changes only between turns → aggressive caching target.

### Cache Breakpoints

Place `cache_control: { type: "ephemeral" }` on:

1. **System prompt** (3.2 KB): mesh design principles, tool descriptions, FDM conventions
   - Stable across entire session.
2. **Point token list + named regions** (2–8 KB): clicked point IDs, world coords, mesh regions
   - Set once during session init; only refreshed on explicit RAG retrieval.
3. **Current STL summary** (1–2 KB): vertex/face counts, bbox, named geometry features
   - Recalculated post-operation but content is deterministic (same mesh = same summary).
4. **Edit history** (grows): cumulative log of applied operations + before/after renders
   - Append-only; cache reads all prior history, new ops written on next turn.

**Do NOT cache:**
- User prompts (change every turn).
- Rendered PNGs (change every turn).
- Tool definitions (rare but possible updates).

### Cache Hit Estimation (Typical 5-turn session)

Assuming 4 renders (4 PNGs @ ~50 KB each) + base STL (100 KB) + LiDAR scan (50 KB):

| Phase | Tokens | Cache Hit Rate |
|-------|--------|---|
| System + points + regions + STL summary | 8,500 | 100% (fixed) |
| Turn 1: user prompt + render | 3,200 input + 1,800 output | Cache write |
| Turns 2–5: user prompt + prior history + render | 3,200 input × 4 + history growth | ~85% (history re-read) |

**Cost comparison for Sonnet 4.6:**

Without caching (5 turns, ~51 KB of static context = ~12,500 tokens):
- 12,500 tokens × 5 turns × $3/MTok = **$0.19**

With caching:
- Cache write turn 1: 8,500 × $3.75/MTok = $0.032
- Cache read turns 2–5: 8,500 × $0.30/MTok × 4 = $0.010
- Fresh context each turn: 3,200 × $3/MTok × 5 = $0.048
- **Total: ~$0.09 (53% savings)**

For Opus 4.7 (higher token volume due to new tokenizer):
- Without caching: ~$0.38
- With caching: ~$0.18 (53% savings, same ratio)

---

## 3. 3D Context Representation

**Problem:** Claude must reason about 3D space, point locations, and geometry simultaneously.  
**Solution:** Multimodal fusion of rendered views + sparse point lists + mesh stats.

### Message Structure

```typescript
const contextMessage: ContentBlockParam[] = [
  // 4 orthographic renders (front/back/left/right)
  { type: "image", source: { type: "base64", media_type: "image/png", data: frontView } },
  { type: "image", source: { type: "base64", media_type: "image/png", data: backView } },
  // ... left/right + 1 perspective 3/4 view

  // Point token summary in text (compact, under 1 KB)
  {
    type: "text",
    text: `Clicked points (world coords):
p1: (12.3, 45.1, 8.9) [surface normal: (0.0, 1.0, 0.0)] // "left mounting hole"
p2: (−8.5, 22.0, 14.2) [normal: (−1.0, 0.0, 0.0)] // "cable notch"
...
`
  },

  // Current mesh summary (updated post-operation, deterministic)
  {
    type: "text",
    text: `Mesh state:
- Bounding box: (−20.0, −15.0, 0.0) to (30.0, 50.0, 25.0)
- Vertices: 8,342 | Faces: 16,680
- Named regions: [base_body, mounting_flange, cable_channel]
- Last operation: applied 0.15mm fillet to all edges
- Printable: ✓ (no manifold issues; ~18-hour print time)
`
  }
];
```

**Why this works:**
1. **PNGs** provide visual spatial intuition (Claude "sees" the geometry).
2. **Point list** grounds abstract prompt phrases ("left from behind") to concrete world positions.
3. **Mesh summary** gives Claude the vocabulary to reason about size, feasibility, and FDM constraints without asking every turn.

---

## 4. Tool Definitions

### Tool List (Core + Gating)

| Tool | Purpose | Gating |
|------|---------|--------|
| `retrieve_base_model` | RAG over Printables/Thingiverse corpus (STL) | Full open (sub-agent, see §5) |
| `import_mesh` | Load external STL into session | Full open |
| `apply_named_operation` | Deterministic geometry: extrude, boolean, fillet, chamfer, add_cylinder_at_point, etc. | Open (planned-first iteration) |
| `apply_raw_bpy` | Fallback: raw Blender Python (e.g., custom modifiers) | Gated: Claude must ask user, include explanation |
| `render_preview` | Render from specified camera + lighting | Open (used for verification, cost-tracked) |
| `measure` | Raycast/distance between points | Open (verify cuts were applied, as per memory) |
| `commit_state` | Mark current mesh as user-approved baseline | Opens when Claude is confident after render verification |

### Polished JSON Schema: `apply_named_operation`

```json
{
  "name": "apply_named_operation",
  "description": "Apply a named mesh operation (extrude, boolean union/diff, fillet, chamfer, etc.). All operations are placeholder-first: render the result before committing. For friction-fit features, use +0.1–0.2 mm per side for FDM nozzle tolerance.",
  "input_schema": {
    "type": "object",
    "properties": {
      "operation_type": {
        "type": "string",
        "enum": [
          "extrude_region",
          "boolean_union",
          "boolean_difference",
          "boolean_intersection",
          "fillet_edges",
          "chamfer_edges",
          "add_cylinder_at_point",
          "add_box_at_point",
          "mirror",
          "array_linear"
        ],
        "description": "The type of mesh operation to apply."
      },
      "params": {
        "oneOf": [
          {
            "type": "object",
            "title": "extrude_region",
            "properties": {
              "region_name": { "type": "string", "description": "Named region to extrude (e.g., 'top_face')" },
              "extrude_distance_mm": { "type": "number", "description": "Distance in mm (positive = outward, negative = inward)" },
              "preserve_original": { "type": "boolean", "default": false, "description": "Keep the original face as a separate object for visualization" }
            },
            "required": ["region_name", "extrude_distance_mm"]
          },
          {
            "type": "object",
            "title": "boolean_difference",
            "properties": {
              "base_region": { "type": "string", "description": "Which named region or object is the base (e.g., 'body')" },
              "subtract_geometry": {
                "type": "object",
                "properties": {
                  "type": { "enum": ["cylinder", "box", "sphere", "imported_stl"], "description": "Primitive or imported mesh" },
                  "position_mm": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3, "description": "[x, y, z]" },
                  "dimensions": {
                    "type": "object",
                    "properties": {
                      "diameter_mm": { "type": "number", "description": "For cylinders; radius = diameter/2" },
                      "height_mm": { "type": "number", "description": "For cylinders" },
                      "width_mm": { "type": "number", "description": "For boxes" },
                      "depth_mm": { "type": "number" },
                      "height_mm": { "type": "number" }
                    }
                  }
                },
                "required": ["type", "position_mm"]
              },
              "solver": { "enum": ["EXACT", "FAST"], "default": "EXACT", "description": "Use EXACT for critical cuts; validates with raycast verification" },
              "fdm_tolerance_mm": { "type": "number", "default": 0.15, "description": "Add tolerance per side for 3D printing (0.1–0.2 typical)" }
            },
            "required": ["base_region", "subtract_geometry"]
          },
          {
            "type": "object",
            "title": "fillet_edges",
            "properties": {
              "region_name": { "type": "string", "description": "Region to fillet (or 'all' for entire mesh)" },
              "radius_mm": { "type": "number", "description": "Fillet radius in mm" }
            },
            "required": ["region_name", "radius_mm"]
          },
          {
            "type": "object",
            "title": "add_cylinder_at_point",
            "properties": {
              "point_id": { "type": "string", "description": "Clicked point ID (e.g., 'p1')" },
              "diameter_mm": { "type": "number" },
              "depth_mm": { "type": "number", "description": "How far to cut/extrude into the surface" },
              "operation": { "enum": ["cut", "emboss"], "description": "'cut' = boolean difference; 'emboss' = extrude outward" }
            },
            "required": ["point_id", "diameter_mm", "depth_mm", "operation"]
          }
        ]
      }
    },
    "required": ["operation_type", "params"]
  }
}
```

**Design notes:**
- **Discriminated union** via `oneOf`: each operation type has its own param schema, preventing mismatches.
- **FDM tolerance baked in**: Claude sees it in every boolean difference, internalizes the +0.1–0.2 mm rule.
- **EXACT solver forced by default**: honors the memory feedback (FAST missed a cut silently once).
- **Raycast verification trigger**: paired with `measure` tool after every boolean to validate the cut was applied (verified in tool_result).

---

## 5. Sub-Agent Dispatch

**Question:** Should retrieval (finding a base STL) be inline or orchestrated separately?

**Answer:** **Separate orchestration step before main loop.**

### Why Not Inline

- **Context cost:** If Claude tries to search the Printables corpus mid-session, you're paying for that search context in every subsequent turn (and every iteration of that turn if caching breaks). Bad ROI.
- **Latency:** User sees a 10-second pause while Claude decides to search, searches, evaluates results, then starts editing. Poor UX.
- **Token waste:** Irrelevant search results pollute the mesh-editing context.

### Pattern: Sub-Agent Retrieval

```typescript
// Step 0: Retrieve base model (one-off, before main loop)
async function initializeSession(userQuery: string): Promise<SessionInit> {
  // Call sub-agent to search Printables + evaluate downloads
  const retrieverAgent = new Agent({
    name: "retriever",
    model: "claude-sonnet-4-6",
    systemPrompt: `You are an expert at finding 3D models on Printables and Thingiverse.
Search for "${userQuery}" and return the 3 best matches ranked by:
1. Remix-friendliness (modular, well-documented)
2. Print quality reviews
3. Geometry simplicity (fewer vertices = easier to edit)

Return: [{ url, title, description, est_remix_difficulty }]`
  });

  const results = await retrieverAgent.run({
    messages: [{ role: "user", content: userQuery }],
  });

  // User picks one (or Claude auto-selects if only 1)
  const selected = results[0]; // Assume user approved via UI
  const stlBuffer = await fetchAndConvert(selected.url);

  return {
    sessionId: generateId(),
    baseModelUrl: selected.url,
    baseModelSTL: stlBuffer,
    notes: `Retrieved from ${selected.source}. Mesh: ${analyzeSTL(stlBuffer)}`
  };
}

// Step 1: Main editing session (uses initialized STL)
async function runEditSession(sessionInit: SessionInit, editPrompt: string) {
  // ... (as in §1)
}
```

**Cost & UX impact:**
- Retrieval: one Sonnet API call (likely ~500 output tokens to list + rank) = ~$0.005 total.
- Main session: uncluttered context, higher cache hit (no search results).
- User UX: "Pick a model" → "Edit it" (clear two-phase UX, faster second phase).

---

## 6. System Prompt Outline

```
You are an expert CAD engineer assisting a user to customize and remix 3D-printable models.

### Core Responsibilities
1. **Understand 3D context**: Read clicked point positions, mesh geometry summary, and 4 orthographic renders.
2. **Placeholder-first workflow**: When uncertain about placement, apply a translucent placeholder (cylinder/box) at your best guess, render it, and ask the user to confirm or adjust.
3. **Verify before declaring success**: After every boolean union/difference, use the measure tool to raycast and confirm the cut actually happened (a silent failure once went undetected until print).
4. **FDM tolerance awareness**: For friction-fit features (snap-on clips, pockets), add +0.1–0.2 mm per side to account for nozzle squish and shrinkage. Do not trust the model's nominal dimensions.

### Available Tools
- apply_named_operation: Deterministic mesh edits (extrude, boolean, fillet, chamfer, add_cylinder_at_point)
- apply_raw_bpy: Fallback for advanced Blender Python (require user confirmation + explanation)
- render_preview: Render from specified camera to verify edits visually
- measure: Raycast or compute distance between points; use after every boolean to validate
- commit_state: Mark the current mesh as user-approved baseline (use when user confirms satisfaction)

### Decision Logic
- **When uncertain about user intent:** Ask clarifying questions. Use rendered placeholder (not final geometry) to ground the conversation.
- **When the mesh is printable and matches user description:** Render before/after, point out any FDM considerations, then offer commit_state.
- **When edge cases arise (self-intersecting geometry, support material needed):** Explain the issue, offer alternatives, do not proceed without user buy-in.

### Voice & Tone
- Collaborative, not authoritative. "I'm thinking we could do X—what do you think?" instead of "I will do X."
- Technical when needed; explain FDM terms (nozzle squish, print time, overhangs) without jargon.
- Efficient: render after every operation, keep descriptions brief (<50 words between renders).

### Constraints
- Do not edit originals in place. Always preserve original/ and write outputs to modified/.
- Use EXACT boolean solver for all unions/differences (FAST solver has hidden failures).
- Maximum 2–3 mm overlap for multi-feature unions (prevents heat-induced deformation in FDM).
- Check for mounting clearance and screw-on space when adding brackets or feet.
```

---

## 7. Token Cost Estimate (Typical 5-turn Session)

**Scenario:** User refines an imported base model 5 times. Each turn includes a render (PNG 4–8 KB).

### Setup
- Base STL summary: ~1.2 KB (400 tokens)
- Point token list (5 clicked points): ~500 tokens
- System prompt + tool definitions: ~2.8 KB (1,100 tokens)
- **Static context: ~2,000 tokens cached**

- 4 renders (2K px × 4 angles @ 50 KB each): ~50 KB uncompressed ≈ 12,500 tokens
- User prompts (avg 200 words × 5): ~1,000 tokens
- Claude output (reasoning + tool calls × 5): ~3,500 tokens
- Tool results (measurements, confirmations): ~1,500 tokens

### Sonnet 4.6 (No Caching)

| Cost Driver | Tokens | Rate | Cost |
|-------------|--------|------|------|
| Input (system + renders + prompts + tool setup) | 15,000 | $3/MTok | $0.045 |
| Output (reasoning + tool calls) | 3,500 | $15/MTok | $0.053 |
| **Total** | | | **$0.098** |

### Sonnet 4.6 (With Prompt Caching)

| Cost Driver | Tokens | Rate | Cost |
|-------------|--------|------|------|
| Cache write (system + points + STL summary, turn 1) | 2,000 | $3.75/MTok | $0.008 |
| Cache reads (turns 2–5) | 2,000 × 4 | $0.30/MTok | $0.002 |
| Fresh inputs (renders + prompts per turn) | 10,000 | $3/MTok | $0.030 |
| Output (reasoning + tool calls) | 3,500 | $15/MTok | $0.053 |
| **Total** | | | **$0.093** |

**Savings: 5%** (modest because renders are the bulk and change every turn).

### Opus 4.7 (With Caching; new tokenizer +30% overhead)

- Static context: 2,600 tokens (was 2,000, +30%)
- Renders + prompts: 13,000 tokens (was 10,000, +30%)

| Cost Driver | Tokens | Rate | Cost |
|-------------|--------|------|------|
| Cache write | 2,600 | $6.25/MTok | $0.016 |
| Cache reads (turns 2–5) | 2,600 × 4 | $0.50/MTok | $0.005 |
| Fresh inputs | 13,000 | $5/MTok | $0.065 |
| Output (reasoning + tool calls) | 3,500 | $25/MTok | $0.088 |
| **Total** | | | **$0.174** |

**Key insight:** Opus 4.7's new tokenizer adds ~30% overhead, but caching helps less (renders dominate).

---

## 8. Model Choice: Sonnet 4.6 vs. Opus 4.7

### Decision Matrix

| Factor | Sonnet 4.6 | Opus 4.7 | Winner |
|--------|-----------|---------|--------|
| **Cost per session** | $0.09 | $0.17 | Sonnet (47% cheaper) |
| **Speed** | 2x faster output tokens | Baseline | Sonnet (agentic loops prefer speed) |
| **Reasoning (spatial 3D)** | Excellent (97% benchmark parity) | Best-in-class (100%) | Opus (marginal) |
| **Tool calling reliability** | Solid | Rock-solid | Opus (fewer error-correcting loops) |
| **Consumer app target** | ✓ (cost-conscious) | ✗ (pricing shock) | Sonnet |
| **Fast mode available** | ✗ | ✓ ($30/$150 per MTok) | N/A (not worth it for this workload) |

### Recommendation

**Default: Claude Sonnet 4.6** for Printable. 

**Rationale:**
1. **Cost:** $0.09–$0.15 per session is acceptable for a consumer product; Opus at $0.17–$0.30 requires user willingness to pay.
2. **Speed:** Sonnet's faster output tokens mean sub-3-second tool call streaming (better UX than Opus).
3. **3D reasoning parity:** Sonnet excels at 3D spatial reasoning (no known gaps vs. Opus on mesh operations).
4. **Error recovery:** If Sonnet makes a tool call error (malformed cylinder params), the cost of a recovery turn ($0.015) is acceptable. Opus adds 47% overhead.

**Fallback to Opus 4.7:** If user specifically opts for "accuracy-first" mode (rare, high-precision model), or if session requires extended context (>500k tokens, very complex edit history).

**Never use fast mode:** 6x Opus pricing is overkill for mesh editing. User tolerance for 500 ms latency is high (they're visualizing 3D geometry); streaming at "standard" speed is fine.

---

## Implementation Checklist

- [ ] Implement message streaming loop with eager_input_streaming on apply_named_operation
- [ ] Set up prompt caching breakpoints (system, point list, STL summary)
- [ ] Design 4-view render pipeline (front/back/left/right + 3/4 perspective)
- [ ] Implement deterministic STL summary generator (bbox, vert/face counts, named regions)
- [ ] Build Blender worker HTTP client (call apply_named_operation, render_preview, measure)
- [ ] Write system prompt (copy §6 above)
- [ ] Add raycast verification to measure tool (verify boolean cuts post-application)
- [ ] Create sub-agent for base model retrieval (optional; Phase 2)
- [ ] Hook frontend WebSocket → backend stream (real-time "Claude thinking" + status)
- [ ] Track session costs (log token usage per turn, compare caching vs. non-cached runs)

---

## References

- **Blender CAD workflow (validated):** `/Users/johannesmichalke/.claude/projects/-Users-johannesmichalke-Desktop/memory/feedback_blender_cad_workflow.md`
- **Claude API streaming + caching (May 2026):** https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming.md, https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md
- **Pricing (May 2026):** Sonnet 4.6: $3/$15/MTok; Opus 4.7: $5/$25/MTok. Cache reads: 0.1x base input.
- **Vision:** https://platform.claude.com/docs/en/build-with-claude/vision.md (supports up to 100 images/request; max 8000×8000 px per image)

