
# UGC VIP – Video Implementation Package (Specification)

## Overview
UGC VIP converts a storyboard into a client-approved production package through six approval gates. Each stage produces both a human-readable artifact and a structured JSON that feeds the next stage.

---

# Stage 1 – Creative Brief

## Goal
Approve the marketing concept before any visual work.

### Inputs
- Product
- Audience
- Goal
- Platform
- Duration
- Language
- Storyboard
- CTA

### Outputs
- `01_Creative_Brief.md`
- `01_Creative_Brief.json`

### Sample JSON
```json
{
  "product":"Fresh Ready-to-Go Seafood",
  "audience":"Busy professionals 25-35",
  "goal":"Increase Sales",
  "platform":"Instagram Reels",
  "duration":30,
  "language":"Tamil",
  "hook":"No more cleaning seafood!",
  "cta":"Try it today"
}
```

Approval: Story • Hook • CTA • Audience

---

# Stage 2 – Visual Lookbook

## Goal
Lock avatar, product and environment.

### Outputs
- Visual Preview
- `02_Visual_Lookbook.json`

```json
{
  "character":{
    "id":"Hero01",
    "gender":"Female",
    "age":27,
    "skin_tone":"Dusky",
    "hair":"Long ponytail",
    "outfit":"Yellow T-shirt, Blue Jeans"
  },
  "background":{
    "location":"Modern Kitchen",
    "lighting":"Morning Natural",
    "style":"Minimal"
  },
  "product":{
    "brand":"Licious",
    "packaging":"Grey Red"
  },
  "global_style":{
    "aspect_ratio":"9:16",
    "camera":"Handheld UGC",
    "color_grade":"Warm Cinematic"
  }
}
```

Approval: Avatar • Product • Background • Style

---

# Stage 3 – Scene Blueprint

## Goal
Approve story flow.

### Outputs
- Scene Table
- `03_Scene_Blueprint.json`

```json
{
  "scenes":[
    {
      "scene":1,
      "objective":"Hook",
      "location":"Kitchen",
      "action":"Open fridge",
      "dialogue":"Seafood clean pannradhe kashtam...",
      "emotion":"Frustrated",
      "duration":6
    }
  ]
}
```

Approval: Scene Order • Dialogue • Actions

---

# Stage 4 – Director Shot List

## Goal
Approve cinematography.

### Outputs
- Shot List
- `04_Director_Shot_List.json`

```json
{
  "scene":1,
  "shots":[
    {
      "shot":1,
      "type":"Close-up",
      "camera":"Handheld",
      "lens":"35mm",
      "movement":"Push In",
      "duration":2
    },
    {
      "shot":2,
      "type":"Macro",
      "focus":"Product"
    }
  ]
}
```

Approval: Camera • Angles • Shot Sequence

---

# Stage 5 – Google Flow Package

## Goal
Compile approved assets into Flow-ready prompts.

### Outputs
- `05_GoogleFlow_Prompts.txt`
- `05_GoogleFlow_Global.json`

```json
{
  "global_rules":{
    "character_lock":true,
    "product_lock":true,
    "negative_prompt":[
      "No character changes",
      "No logo changes",
      "No extra people"
    ]
  }
}
```

Prompt TXT contains:
- Global Prompt
- Scene 1 Prompt
- Scene 2 Prompt
- ...
- Negative Prompt
- Continuity Rules

Approval: Final Prompt Package

---

# Stage 6 – Production Package

## Goal
Compile the entire project for generation and future edits.

### Outputs
- `06_Project_Master.json`
- `06_GoogleFlow_Scenes.json`

```json
{
  "project":"Seafood Campaign",
  "lookbook_ref":"02_Visual_Lookbook.json",
  "scene_ref":"03_Scene_Blueprint.json",
  "shot_ref":"04_Director_Shot_List.json",
  "flow_global":"05_GoogleFlow_Global.json",
  "flow_prompts":"05_GoogleFlow_Prompts.txt",
  "status":"Approved"
}
```

`06_GoogleFlow_Scenes.json`

```json
{
  "scenes":[
    {
      "scene":1,
      "prompt":"Generated prompt for Scene 1",
      "duration":6
    },
    {
      "scene":2,
      "prompt":"Generated prompt for Scene 2",
      "duration":6
    }
  ]
}
```

Approval: Generate AI videos.

---

# Approval Rules

- Each stage must be approved before proceeding.
- Unlocking a stage invalidates downstream approvals.
- JSON files are the source of truth.
- Prompt files are compiled from approved JSONs.
- Only Stage 5 generates Google Flow prompts.
- Stage 6 packages the entire project for regeneration and delivery.
