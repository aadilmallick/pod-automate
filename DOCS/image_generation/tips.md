## Tapping into the Power of Layers

### Problem with Prompts
Most prompts are just a bunch of text without layers. This makes it hard for the AI to generate what you want. You might end up with something that's close, but not quite right.

### The Layered Approach
Instead of one blob of text, break your prompt into *layers*. Each layer controls one aspect of the image:
* **Subject**: What's in the image
* **Style**: How it looks (realistic, artistic, etc.)
* **Camera**: Technical settings (angle, lens, depth of field)
* **Lighting**: Where light comes from, what quality
* **Environment**: Background, setting, atmosphere
* **Color**: Palette, dominant tones
* **Mood**: Emotional feel

### Problem with Most "Prompt Guides"
Most prompt guides give you layers for PEOPLE:
* Pose, Clothing, Skin texture, Hair, Eyes, Hands
But what about:
* A product shot?
* A landscape?
* Food photography?
* An abstract concept?

### Fix: Subject-Aware Layers
The prompt generator I'm sharing detects your subject type and activates the right layers:
* **Human**: Pose, clothing, features, face, eyes, hands
* **Object**: Materials, textures, form, state, presentation
* **Scene**: Landscape, architecture, weather, time of day
* **Abstract**: Visual metaphor, pattern, flow, dimension
* Always include:
	+ Subject & core concept
	+ Style & mood
	+ Camera angle, lens, depth of field
	+ Lighting type, direction, quality
	+ Environment & background
	+ Color palette
	+ Aspect ratio
	+ Negative prompt (what to avoid)
	+ Platform target
### Example
Vague input:
> "A festive ham for Christmas"
Layered output:
> A hyper-realistic photograph of a perfectly glazed holiday ham on an elegant white ceramic platter. The ham features a diamond-cut pattern with a glistening maple-brown sugar glaze, studded with whole cloves. Surrounding the ham are fresh rosemary sprigs, bright red cranberries, and caramelized orange slices. The platter sits on a rustic dark wood table with a deep green velvet table runner. Warm, golden side lighting creates a rich glow on the glaze and soft shadows beneath. Background shows a softly blurred Christmas tree with warm white fairy lights and red ornaments. Atmosphere is cozy, celebratory, and inviting. Shot with 85mm lens, shallow depth of field, eye-level angle.
Negative prompt (if needed for some AIs):
> Avoid: artificial looking food, plastic appearance, harsh shadows, cluttered composition, visible hands, text, watermarks

### Negative Prompts to Up the Quality
Telling the AI what to AVOID can be as important as telling it what to include.
Add a negative prompt layer:
> Avoid: distorted hands, extra limbs, blurry, low resolution, watermarks, text, cropped frame, artificial lighting

### Platform Matters
Different platforms may have different quirks:
The generator adapts your prompt to your target platform.

### How to Use This
Use the layer checklist as a mental framework. Before you hit generate, ask:
* Did I specify the camera/angle?
* Did I specify lighting?
* Did I specify style?
* Did I add a negative prompt?

### Quick Reference
* **Detect Subject Type**
	+ Human: Pose, clothing, features, face, eyes, hands
	+ Object: Materials, textures, form, state, presentation
	+ Scene: Landscape, architecture, weather, time of day
	+ Abstract: Visual metaphor, pattern, texture
* **Always Include**
	+ Subject & core concept
	+ Style & mood
	+ Camera angle, lens, depth of field
	+ Lighting type, direction, quality
	+ Environment & background
	+ Color palette
	+ Aspect ratio
	+ Negative prompt (what to avoid)
	+ Platform target
* **Output Format**
	+ Main prompt (single paragraph)
	+ Specifications summary
	+ Negative prompt (separate)

### Get the Generator
The full Layered Image Prompt Generator v2 is attached.
It includes:
	+ Subject detection logic
	+ Complete layer sets for all subject types
	+ Negative prompt templates
	+ Platform-specific syntax notes
	+ Example workflows
	+ Quick reference

### Deeper Principle
This isn't really about image generation. It's about *intentional prompting*.
Vague input → vague output. Every time.
When you think in layers, you're forced to make decisions *before* you generate. You stop hoping the AI guesses right. You start directing it.
The same principle applies everywhere:
	+ Writing prompts
	+ Code generation
	+ Analysis requests
	+ Any AI task
Be specific. Be structured. Be intentional.
Your results will follow.
That's the difference layers make. (1st pic, layered prompt), 2nd pic: plain prompt)
