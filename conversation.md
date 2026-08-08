# AI-Powered Mockup Automation

**User:** Anonymous  
**Created:** 8/7/2026 18:37:03  
**Updated:** 8/7/2026 20:30:23  
**Exported:** 8/7/2026 20:31:20  
**Link:** [https://chatgpt.com/c/6a765dba-8984-83ea-992f-7cf98016e1ef](https://chatgpt.com/c/6a765dba-8984-83ea-992f-7cf98016e1ef)  

## Prompt:
8/7/2026, 6:37:02 PM

Perform research on [https://mockupbee.io/](https://mockupbee.io/) and read how mockup automation works at [https://mockupbee.io/blog/how-to-save-hours-each-week-with-mockup-automation](https://mockupbee.io/blog/how-to-save-hours-each-week-with-mockup-automation)  Because I want to create an app that allows me to generate a bunch of images with AI or something that's provider agnostic and then create mockups from that automatically and then upload those to Etsy for example as one provider or I could make a provider agnostic and upload to something like T public or other stores for example. Basically it should use good programming principles always programmed to interfaces rather than concrete details so that you can make this very flexible. talk with me and ask me questions to form an in-depth PRD on how to create a web app (deno + hono + AI image inference that is provider agnostic, uses vercel AI, openrouter, Nano Banana, open source image models, and FalAI as concrete image production providers) that allows for the automation of creating print-on-demand images with AI or manually uploading files and then automatically creating mockup images for those, and then also using any APIs these marketplaces have like Etsy [https://developers.etsy.com/documentation/](https://developers.etsy.com/documentation/)  if they are available for automatic uploading, otherwise, you can just download the zip file of those batch mockups or upload them to google drive via google OAuth. This app will contain a lot of features, such as ability to choose the AI provider at each AI step (image creation, mockup creation, etc.), google OAuth permissions requesting drive access at runtime, whether to use stripe + better auth + neon SQL + drizzle or to use clerk + clerk billing + optionally db if we actually need to store data (maybe not), so I would just like to talk it through with you so I can get the architecture and intent of the app right (like what do I really want this app to do for me) so vibe coding can one shot this

## Response:
8/7/2026, 6:37:03 PM

> **Personalizing**
>
>
> ****
>
> 
>
> **Personalized AI POD architecture and aligned development preferences**
>
> 
>
> Worked for 8s

Yes - and I think the important thing is **not to start by designing the database or picking Clerk vs. Better Auth**. The first thing we should nail down is the *mental model of the product*.

I researched MockupBee, its automation workflow, and Etsy's current API. There is a pretty clear opportunity to make your idea substantially broader than MockupBee.

[MockupBee](https://mockupbee.io/?utm_source=chatgpt.com) is fundamentally a **bulk mockup renderer**: upload up to 50 designs, select product/mockup templates, and automatically place each design into each selected template, producing ecommerce-ready images. Its original workflow was essentially automating Photoshop Smart Objects: open mockup → insert design → save/export → repeat. ([MockupBee.io](https://mockupbee.io/))

Your idea is more like:

> **"An automation engine for going from an idea to a finished catalog of AI-generated POD products, with every stage replaceable by whatever provider I want."**

That's a much more interesting architecture.

And importantly, Etsy does currently support creating draft listings and uploading listing images through its API. ([Etsy Developers](https://developers.etsy.com/documentation/tutorials/listings/?utm_source=chatgpt.com)) So Etsy doesn't necessarily have to be a manual-download-only destination. For your own shop, Etsy currently has a Seller App path specifically intended for automations/tools for your own shop. ([Etsy Developers](https://developers.etsy.com/documentation/))

Also, the AI provider abstraction is particularly viable now because OpenRouter has a unified image API covering 30+ models/providers and supports provider ordering/fallback behavior. ([OpenRouter](https://openrouter.ai/blog/tutorials/image-generation-models/?utm_source=chatgpt.com))

---

# First: I think we should define the product differently

I wouldn't describe this primarily as a **mockup generator**.

I'd describe it as an:

## AI POD Production Pipeline

Something like:

```text
                    ┌──────────────────┐
                    │   Product Idea   │
                    └────────┬─────────┘
                             ↓
                    ┌──────────────────┐
                    │ Generate Designs │
                    └────────┬─────────┘
                             ↓
                    ┌──────────────────┐
                    │ Transform Assets │
                    │                  │
                    │ • background     │
                    │ • upscale        │
                    │ • remove BG      │
                    │ • resize         │
                    │ • edit           │
                    └────────┬─────────┘
                             ↓
                    ┌──────────────────┐
                    │ Generate Mockups │
                    └────────┬─────────┘
                             ↓
                    ┌──────────────────┐
                    │ Create Listings  │
                    │                  │
                    │ • title          │
                    │ • description    │
                    │ • tags           │
                    │ • images         │
                    │ • pricing        │
                    └────────┬─────────┘
                             ↓
               ┌─────────────┼─────────────┐
               ↓             ↓             ↓
             Etsy          TPublic       Download
```

But even that isn't quite the abstraction I'd use internally.

I'd think of it as:

> **Assets enter a workflow. Nodes transform assets. Destinations consume assets.**

That gives us an architecture that can eventually do much more than POD.

---

# The most important architectural distinction

I think there are actually **three different abstractions** here.

### 1. Providers

Things that perform work.

```text
ImageGenerationProvider
ImageEditingProvider
UpscalingProvider
BackgroundRemovalProvider
MockupProvider
MarketplaceProvider
StorageProvider
```

Examples:

```text
ImageGenerationProvider
├── OpenRouter
├── Fal.ai
├── Google/NanoBanana
├── OpenAI
├── Local/ComfyUI
└── FutureProvider

MarketplaceProvider
├── Etsy
├── TPublic
├── Shopify
└── FutureProvider
```

---

### 2. Capabilities

What the provider *can do*.

For example:

```text
generateImage
editImage
removeBackground
upscaleImage
createMockup
uploadListing
createListing
updateListing
```

This is important because **provider ≠ capability**.

Fal might eventually support five capabilities.

OpenRouter might support image generation and editing.

A local ComfyUI installation might support image generation, upscaling, and background removal.

So we shouldn't write:

```ts
if (provider === "fal") ...
```

throughout the application.

Instead:

```ts
interface ImageGenerationProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>
}
```

and the workflow doesn't care who implements it.

---

### 3. Workflows

This is the really powerful part.

A workflow could be:

```text
Generate 20 designs
       ↓
Remove background
       ↓
Upscale
       ↓
Generate 5 lifestyle mockups each
       ↓
Generate Etsy listing metadata
       ↓
Publish to Etsy
```

Or:

```text
Upload my existing PNG
       ↓
Remove background
       ↓
Place onto T-shirt mockup
       ↓
Generate 7 listing images
       ↓
Download ZIP
```

Or:

```text
Upload design
       ↓
Mockup
       ↓
Etsy
```

Or:

```text
Prompt
 ↓
Nano Banana
 ↓
Mockup
 ↓
Google Drive
```

**That's the product.**

---

# There's an important question about "mockups"

This is probably the biggest thing I want us to resolve before writing the PRD.

There are two very different approaches.

### A. Deterministic mockup rendering

Like MockupBee.

You have:

```text
T-shirt PSD
        +
design.png
        ↓
deterministic composition
        ↓
final mockup
```

The design gets inserted into a known region.

This is excellent because the design is preserved exactly.

You could support:

- PSD templates
- SVG templates
- PNG templates
- masks
- displacement maps
- perspective transforms
- blend modes
- shadows
- smart-object-like regions

This is the **MockupBee model**.

---

### B. AI-generated mockups

You give an image model:

> "Put this exact artwork onto a woman wearing a black t-shirt in a cozy coffee shop."

and the model generates the entire image.

This is much more flexible visually, but the model might subtly alter the artwork.

For POD, that distinction matters enormously.

Imagine your design says:

> "SAVE THE BEES"

and the AI changes it to:

> "SAVE THE BEES!"

or alters a character/logo.

That's unacceptable for some products.

So I suspect the best product actually supports **both**:

```text
Mockup Engine
│
├── Deterministic
│   ├── PSD
│   ├── templates
│   ├── masks
│   └── compositing
│
└── Generative
    ├── image-to-image
    ├── reference-image generation
    └── AI scene generation
```

And a workflow could choose which one.

That is much more powerful than simply saying "AI mockups."

---

# And this leads to an even better idea

I think **"template" should be a first-class object**.

For example:

```text
T-Shirt Lifestyle Template
```

might contain:

```text
type: deterministic

canvas:
  width: 2000
  height: 2000

designPlacement:
  x: ...
  y: ...
  width: ...
  height: ...

effects:
  perspective: ...
  displacement: ...
  shadow: ...
```

Whereas:

```text
Woman Wearing T-Shirt
```

might be:

```text
type: generative

prompt:
  "Professional lifestyle photograph..."

referenceImages:
  [person.jpg, shirt.jpg]
```

Then the workflow doesn't care.

It simply says:

```text
Apply Template
```

---

# Another thing I really like about your idea

You said:

> "choose the AI provider at each AI step"

**I think this should be fundamental to the product, not an advanced feature.**

Imagine a workflow UI:

```text
┌─────────────────────────────────────┐
│ Generate Designs                    │
│                                     │
│ Provider: [ OpenRouter ▼ ]          │
│ Model:    [ Nano Banana 2 ▼ ]       │
│                                     │
│ Quantity: 20                        │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ Remove Background                   │
│                                     │
│ Provider: [ Fal.ai ▼ ]              │
│ Model:    [ RMBG-2.0 ▼ ]            │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ Upscale                             │
│                                     │
│ Provider: [ Fal.ai ▼ ]              │
│ Model:    [ Real-ESRGAN ▼ ]         │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ Create Mockups                      │
│                                     │
│ Method: [ AI Generation ▼ ]         │
│ Provider: [ OpenRouter ▼ ]          │
│ Model: [ Nano Banana Pro ▼ ]        │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│ Publish                             │
│                                     │
│ Destination: [ Etsy ▼ ]             │
└─────────────────────────────────────┘
```

And **provider selection should be configuration**, not workflow logic.

---

# I would also separate "model" from "provider"

This is subtle but important.

You mentioned:

> Vercel AI, OpenRouter, Nano Banana, open-source models, FalAI

I'd avoid treating those as equivalent things.

They're different layers.

For example:

```text
Application
     ↓
Capability
     ↓
Provider Adapter
     ↓
Model
```

Potentially:

```text
ImageGeneration
     ↓
OpenRouter
     ↓
google/gemini-3.1-flash-image
```

or:

```text
ImageGeneration
     ↓
Fal
     ↓
flux-pro
```

or:

```text
ImageGeneration
     ↓
Google
     ↓
Nano Banana
```

or:

```text
ImageGeneration
     ↓
LocalInference
     ↓
FLUX
```

This means the app can expose a unified model catalog without coupling the workflow engine to the underlying vendors.

OpenRouter is especially interesting here because it already gives you a unified image API and model catalog, including Google, OpenAI, Black Forest Labs, Recraft, ByteDance, xAI and others. ([OpenRouter](https://openrouter.ai/blog/tutorials/image-generation-models/?utm_source=chatgpt.com))

---

# I think the app should have two modes

This is something I'd like you to think about.

## Mode 1 - "Create"

You want to make products.

You say:

> "I want 30 vintage botanical cat designs."

The system helps you produce:

```text
30 designs
     ↓
review
     ↓
select 12
     ↓
mockups
     ↓
review
     ↓
publish
```

---

## Mode 2 - "Automate"

You define a reusable pipeline.

```text
Input Design
    ↓
Remove BG
    ↓
Upscale
    ↓
7 Mockups
    ↓
Generate metadata
    ↓
Etsy
```

Then every time you upload a new design:

**Run pipeline.**

That could become the real killer feature.

---

# And I would make assets persistent

Instead of thinking:

> "I generated an image."

Think:

> "I created an asset."

An asset has provenance.

For example:

```text
Asset #184
│
├── source
│   └── generated
│
├── provider
│   └── OpenRouter
│
├── model
│   └── Nano Banana 2
│
├── prompt
│   └── ...
│
├── input assets
│   └── ...
│
├── workflow
│   └── workflow #12
│
└── outputs
    ├── original.png
    ├── upscaled.png
    ├── mockup-01.png
    ├── mockup-02.png
    └── mockup-03.png
```

Now you get **reproducibility**.

That's very valuable for AI workflows.

You could say:

> "Regenerate these using a different provider."

or:

> "Run the same workflow on these 50 designs."

---

# I also think we should distinguish Designs, Mockups, and Listings

They're not the same thing.

### Design

The actual artwork.

```text
design.png
```

### Product presentation

The mockups.

```text
design.png
    ↓
mockup 1
mockup 2
mockup 3
mockup 4
```

### Listing

Marketplace-specific metadata:

```text
title
description
tags
price
images
category
materials
SKU
variants
etc.
```

So:

```text
Design
   ↓
Product
   ↓
Listing
```

A single design might become:

```text
Design
 ├── Etsy Listing
 ├── TPublic Listing
 ├── Shopify Product
 └── Downloadable ZIP
```

That is a **much cleaner domain model** than making Etsy the center of the application.

---

# Etsy should be an adapter

Something like:

```ts
interface MarketplaceProvider {
  authenticate(): Promise<AuthResult>

  createListing(
    listing: Listing
  ): Promise<MarketplaceListing>

  uploadImages(
    listing: MarketplaceListing,
    images: Asset[]
  ): Promise<void>

  publishListing(
    listing: MarketplaceListing
  ): Promise<void>

  updateListing(...): Promise<void>

  deleteListing(...): Promise<void>
}
```

Then:

```text
MarketplaceProvider
├── EtsyProvider
├── ShopifyProvider
├── TPublicProvider
├── RedbubbleProvider
└── DownloadProvider
```

Though we shouldn't implement every marketplace just because the abstraction allows it.

**The interface should reflect the domain, not speculative future providers.**

---

# Google Drive is slightly different

I'd treat Drive as a **storage/export destination**, not a marketplace.

```text
Destination
│
├── Marketplace
│   ├── Etsy
│   └── ...
│
├── Storage
│   ├── Google Drive
│   └── ...
│
└── Local
    └── ZIP download
```

And yes, I agree with your runtime OAuth idea.

The user could click:

> **Export to Google Drive**

Then:

```text
Connect Google Drive
        ↓
OAuth consent
        ↓
Request Drive scope
        ↓
Choose folder
        ↓
Export
```

Rather than requesting Drive access when the user merely creates an account.

---

# Authentication / billing / database

I would **not decide this yet**.

The question isn't:

> "Should I use Clerk or Better Auth?"

The question is:

> **What state does the application actually need to persist?**

And I suspect the answer is: quite a lot.

Because once we have:

- workflows
- workflow versions
- assets
- generations
- provider configurations
- API keys
- marketplace connections
- listings
- jobs
- job history
- templates
- projects
- billing/usage

you're no longer really building a stateless app.

I'd expect Postgres to become useful.

But we can determine the actual persistence model before choosing the auth stack.

---

# One architectural thing I would strongly recommend

Don't let the AI SDK become your domain architecture.

Use Vercel AI SDK **inside an adapter**.

For example:

```text
Domain
  ↓
ImageGenerationService
  ↓
ImageGenerationProvider
  ↓
VercelAIProvider
```

Then perhaps:

```text
VercelAIProvider
├── OpenRouter
├── Google
└── ...
```

and:

```text
FalProvider
```

is another implementation.

That way, if six months from now Vercel AI SDK stops being the right abstraction for something, you're not rewriting your application.

Same principle for:

- Stripe
- Clerk
- Etsy
- Google
- Fal
- OpenRouter
- Neon
- Drizzle

**Infrastructure implements application interfaces.**

That's the architecture principle I'd make explicit in the eventual PRD.

---

# The question I want to tackle first

Before we talk about Deno/Hono, Postgres schemas, queues, React components, etc., I want to figure out **what you personally want this thing to do**.

Because there are two very different products hiding inside your description.

### Product A

> "I want a tool for myself that takes my AI-generated designs and automatically turns them into Etsy-ready products."

This could be incredibly opinionated and optimized for your own workflow.

### Product B

> "I want to build a general-purpose automation platform for AI image production and POD."

That's much more ambitious.

And I suspect **we should build A with architecture that permits B**, rather than building B from day one.

---

# So let's start with your actual workflow

Imagine tomorrow you have an idea:

> "I want to make 50 funny cat T-shirt designs."

**Walk me through what you wish would happen from that moment until the products are live.**

Don't worry about architecture or implementation yet.

Tell me things like:

- What would you type into the app?
- How many designs would you want?
- Would AI generate the designs or would you sometimes upload them?
- Would you review/select designs before mockups?
- What types of mockups would you want?
- How many mockups per design?
- Would you want AI-generated lifestyle scenes, deterministic templates, or both?
- Would AI generate Etsy titles/descriptions/tags?
- Would you want the app to automatically publish, or require approval?
- Would you want the same products sent to multiple stores?
- What parts of the process do you **never** want automated?
- What parts currently feel like the most annoying/repetitive work?

**Give me the workflow as you actually envision using it**, even if it's messy. Then I'll challenge the assumptions, identify the core product primitives, and we'll progressively turn that into the architecture and eventually the one-shot PRD.

---

**Sources:**

- [Bulk Mockup Generator for Etsy & Shopify Sellers](https://mockupbee.io/)
- [Listings Tutorial | Etsy Open API v3](https://developers.etsy.com/documentation/tutorials/listings/?utm_source=chatgpt.com)
- [Image Generation API on OpenRouter: Generate + Read Images — OpenRouter Blog](https://openrouter.ai/blog/tutorials/image-generation-models/?utm_source=chatgpt.com)

## Prompt:
8/7/2026, 7:00:10 PM

Yeah, I actually agree with all your suggestions. I think they're probably better than what I even originally thought. So I think the way of saving workflows and having templates, having the ability to to terminusly apply the mockup, or even have AI generate the mockup is really good. I also agree on looking towards the future and making this as future-proof as possible by making everything super provider agnostic. So I agree with all your suggestions. I agree it's important to start by creating a tool for myself that takes whatever designs that are either AI generated that I create within the app or designs that I already have beforehand and then turns them into products ready for different marketplaces that's marketplace agnostic basically. I also do like your idea of having different like removed background providers and resizing the image or converting the image providers, I think that's also really important. So as for the workflow, let's say I want to make 50 funny cat t-shirt designs. Basically what I would type into the app is there would basically be kind of like a number input for how many designs I want to make. And then I would have a prompt saying something like create funny cat t-shirt designs basically, right? Or that would be kind of like the theme, the main theme I'm going for, right? And then I would want like slight variations between them. And then AI would sometimes generate the designs for me. Like if I want to use AI, especially like since I think having local model providers here would be really good. So also having a self-hosted version of this app, a Docker Compose and just being smart about using code to swap out like environment variables. So we're not like hard coding like what is production versus what is self hosted and said just leaving that configuration to environment variables. I think is good. So in a self-hosted version, I would be able to use something local like comfy UI or local image. So I don't spend any money. And that way I can, that's probably the main way I would design the AI, I would tell AI to basically create the images. But I would also sometimes upload them if I designed some myself on Canva and I would upload those images. Right. So if AI is creating then it's just going to be based off one prompt, right? Or like one main theme like create several variations of a JavaScript coding t-shirt basically, right? And I can upload all of those. So it's basically from one like prompt theme is going to create multiple images and I select the number of designs manually via a number input, right? But other times I can just upload images and then and they can be of any dimension basically because we have the resizing background removal providers yada yada down the workflow that can actually change the dimensions of those images and prepare them for different marketplace providers. So yes, I would review slash select designs before mockups. I think that would be good. So just having some basic like image preview components of all the designs that are about to get mocked up decide beforehand, which one I would want to remove or not or like view basically what types of mockups I want. I want this to be flexible. So we could start off with like kind of basic mockups but like most of the ones that T public has, right? So a lot of the ones like t-shirts sweatshirts backpacks phone cases stuff like that, right? So I think just to be easy, we can stick with shirts sweatshirts for now basically any any like top level clothing and then we could also create future implementations to add more like hats or shower curtains or stuff like that. So how many mock up type? Well, I choose and then it makes it for all of them. So for like, if I'm manually uploading, then I choose like how many mock up's per design and like, which ones are they right? So if it's like wall art, so it's going to be like one mock up per like mock up type. So like, if I have an image that I'm trying to make a mock up's for, then three mockups would mean like one is wall art, one is t-shirt, one is sweatshirt. Right? And then that's applied for every single one of the designs that I upload. I can't really configure individually because I want to make sense, basically. So it's fine, but just like that. So I want AI generated lifestyle scenes as well as a termistic template, because I think the termistic templates are probably the easiest way and the most like happy path to make a mock up. But also like AI generated ones where a user can prompt how they want the mock to look like or choose from like prompt presets of creating the mock ups. Yes, I would have AI generate the titles, descriptions, tags per provider if desired. So I would want that to be the default because the user can always change after it's posted to the marketplace. But as you said, the API doesn't really offer a way to automatically publish. So anything that's not really possible to do right now via the API happy path, you can just stop out, honestly. And I would want the app to automatically publish, basically. So the app can either automatically publish or there can be a confirmation model where if the user says no, then it doesn't publish, it doesn't go through, but they can always download their mockups. That's always going to be available for them, basically. So if you're self-hosted, then the mockups will literally just be stored in like either like a Docker volume or they're just probably, it's probably just going to be easy to store them in the file system in your project if you're self-hosting. It via Docker, but online then you're going to have to use an S3 bucket. So basically stuff like that, always program to abstractions rather than details, you know, have different like storage providers, so you can have Google Drive provider, like a local file system provider for storing stuff, or an S3 bucket, right. Well, parts of the process do I never want automated. I don't know, I think I'd want most of it to be automated, but we could go over that later, I think right now it's probably going to be easier to just automate everything, and then we can add manual intervention after. What I want the same products to be sent to multiple stores, probably that the user select which stores they want to send to and they're workflow. But yeah, as you said, it's going to be pretty hard to do any of that without web scraping, making automatic listings and stuff, so you could just like stub that out for now, basically. But the actual wiring of the user selecting and then automatically publishing to stores should be set up, even if you have to stub out the actual implementation. The parts that currently feel like the most annoying and repetitive work is publishing to the stores. That's where the biggest value proposition lies. It's also creating the mockups. Sometimes sites like T public will allow you to create the mockups automatically from one image, But for stuff like Etsy, you have to manually create the mockups yourself, which costs money, and is annoying and takes time.  Also, the AI will help in actually creating the designs and even creating the mockups if you want that over deterministic mockups. But deterministic mockups should be a core part of the workflow, not really. That's pretty essential as well because deterministic mockups are great, they're fast, and they work. But AI creating the designs actually helps remove a lot of the friction.

## Response:
8/7/2026, 7:00:12 PM

Yes. I think we now have a **very strong product definition**, and importantly, I think the product is becoming clearer than "an AI mockup generator."

The thing you're actually building is closer to:

> **A provider-agnostic production and publishing pipeline for turning designs into marketplace-ready POD products.**

The AI image generation is one input. Mockup generation is one transformation. Etsy is one output. None of those should own the architecture.

## What I think we've decided

The core lifecycle is now:

```text
                    ┌─────────────────┐
                    │   Create Batch  │
                    └────────┬────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
         AI-generated                User upload
                │                         │
                └────────────┬────────────┘
                             ↓
                    ┌─────────────────┐
                    │ Design Assets   │
                    │                 │
                    │ 50 designs      │
                    └────────┬────────┘
                             ↓
                       REVIEW / SELECT
                             ↓
                    ┌─────────────────┐
                    │ Asset Processing│
                    │                 │
                    │ BG removal      │
                    │ Resize          │
                    │ Convert         │
                    │ Upscale         │
                    │ etc.            │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Mockup Pipeline │
                    │                 │
                    │ Deterministic   │
                    │ OR AI-generated │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Product         │
                    │                 │
                    │ Design          │
                    │ Mockups         │
                    │ Metadata        │
                    └────────┬────────┘
                             ↓
                       REVIEW / EDIT
                             ↓
                    ┌─────────────────┐
                    │ Publish/Export  │
                    └────────┬────────┘
                             ↓
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
        Etsy              TPublic          Google Drive
```

And **every box is an abstraction boundary**.

That's the part I think will make the eventual implementation prompt excellent.

---

# There's another important abstraction I want to introduce

I think we should distinguish between a **Workflow** and a **Run**.

For example, you might create:

### "Funny Cat T-Shirts"

```text
Generate Designs
       ↓
Remove Background
       ↓
Resize
       ↓
Create T-Shirt Mockups
       ↓
Generate Etsy Metadata
       ↓
Publish to Etsy
```

That's the **workflow definition**.

Then tomorrow you run it:

```text
Run #1
50 designs
August 7, 2026
```

And next week:

```text
Run #2
25 designs
August 14, 2026
```

The workflow remains reusable.

This also gives us something really valuable:

### Workflow versioning

Suppose you change:

```text
Nano Banana
```

to:

```text
FLUX
```

You shouldn't accidentally change what an old run means.

So we can eventually have:

```text
Workflow
  ├── Version 1
  ├── Version 2
  └── Version 3
```

And every run records exactly which version it used.

That gives you reproducibility and auditability basically for free.

---

# I also think your self-hosting requirement changes the architecture in a good way

I'm very much on board with this.

The application should essentially have:

```text
                 Application
                      │
        ┌─────────────┴──────────────┐
        │                             │
   Cloud deployment              Self-hosted
        │                             │
        ↓                             ↓
    S3 Storage                  Local Storage
    Postgres                    Postgres
    Fal.ai                      Local ComfyUI
    OpenRouter                  Local Models
```

But **the application doesn't know any of that**.

It sees:

```ts
interface StorageProvider {
  put(...)
  get(...)
  delete(...)
  getUrl(...)
}
```

and:

```ts
interface ImageGenerationProvider {
  generate(...)
}
```

and:

```ts
interface MarketplaceProvider {
  createListing(...)
  uploadImages(...)
  publish(...)
}
```

The environment/configuration decides which implementation gets injected.

That's exactly the sort of architecture where your eventual Docker Compose deployment can be something like:

```text
app
postgres
comfyui
```

while the hosted version might be:

```text
app
neon
s3
fal.ai
openrouter
```

**without changing the application domain logic.**

---

# One thing I'd change from our earlier discussion

I don't think we should make the user explicitly construct a complicated workflow graph for the first version.

That would be a mistake.

You know what you want:

> "Make me 50 funny cat shirt designs, mock them up, generate the listings, and publish them."

The app should make that easy.

So I envision two layers:

### Simple mode

The user sees a guided wizard:

```text
1. What are you making?
   [ Funny cat T-shirts ]

2. How many?
   [ 50 ]

3. Design source
   ○ Generate with AI
   ○ Upload existing designs

4. Mockups
   ☑ T-shirt
   ☑ Sweatshirt
   ☐ Hoodie

   ○ Deterministic templates
   ○ AI lifestyle scenes
   ☑ Both

5. Marketplaces
   ☑ Etsy
   ☐ TPublic
   ☐ Download only

6. Publishing
   ● Automatically publish
   ○ Review before publishing

             [Create Products]
```

And internally that creates a workflow/run.

### Advanced mode

Eventually:

```text
Workflow Builder
```

where you can actually manipulate:

```text
[Generate Image]
       ↓
[Remove BG]
       ↓
[Upscale]
       ↓
[Mockup]
       ↓
[Generate Metadata]
       ↓
[Publish]
```

This lets us keep the product approachable while still building the underlying workflow engine correctly.

---

# And I think "batch" should be a first-class concept

Because you're not really creating individual products.

You're saying:

> **"Create 50 related products."**

So I'd introduce:

```text
Project
   ↓
Batch
   ↓
Assets
   ↓
Products
   ↓
Listings
```

For example:

```text
Project:
Funny Cat T-Shirts

Batch:
August 7 Cat Collection

Assets:
cat-001.png
cat-002.png
...
cat-050.png

Products:
cat-001-shirt
cat-002-shirt
...

Listings:
Etsy/cat-001
TPublic/cat-001
...
```

This will make the UI much more natural.

---

# The really interesting part is the marketplace layer

I think we should **not** make "Etsy listing" the fundamental product.

Instead:

```text
Product
│
├── Design
├── Product configuration
├── Mockups
└── Metadata
       │
       ├── Etsy Listing
       ├── TPublic Listing
       └── Shopify Product
```

Because the metadata may differ.

For example:

```text
Product
  title
  description
  artwork
  mockups
  price
  variants
```

Then:

```text
EtsyListing
  title
  description
  tags
  category
  taxonomy
  materials
  images
```

while TPublic may have an entirely different representation.

So each marketplace adapter converts:

```text
UniversalProduct
       ↓
Marketplace-specific representation
```

That's a **very important architectural boundary**.

---

# And I think your value proposition is now extremely clear

There are really **three things you're eliminating**:

### 1. Design creation

> "I don't have to manually make 50 variations."

### 2. Product photography/mockups

> "I don't have to manually create 5–10 images for every design."

### 3. Marketplace operations

> "I don't have to repeatedly upload those images and type the same metadata into every marketplace."

So the complete value proposition becomes:

> **Go from an idea to a batch of marketplace-ready POD listings with minimal manual work.**

That's considerably more compelling than:

> "AI mockup generator."

---

# One major feature I think we should explicitly design around

## The approval boundary

You said:

> "I'd want most of it automated."

I agree.

But I wouldn't make the system fundamentally "all-or-nothing."

Every workflow stage should eventually be able to have a policy:

```text
AUTO
REVIEW
SKIP
```

For example:

```text
Generate designs      → AUTO
Design selection      → REVIEW
Remove background     → AUTO
Resize                → AUTO
Generate mockups      → AUTO
Mockup selection      → REVIEW
Generate metadata     → AUTO
Publish Etsy          → REVIEW
```

And later:

```text
Publish Etsy → AUTO
```

when you trust the workflow.

This is a much better model than adding a bunch of special-case "confirmation dialogs."

---

# Now I want to drill into one important product question

We've established **how a batch gets created**.

The next thing I want to understand is:

## **What exactly is a "product" in your mind?**

For example, suppose you generate:

> 50 funny cat designs.

Do you envision **one design becoming multiple products automatically?**

For example:

```text
Cat #1
 ├── T-Shirt
 ├── Sweatshirt
 ├── Hoodie
 └── Phone Case
```

or is the initial mental model:

```text
Cat #1 → T-Shirt
Cat #2 → T-Shirt
...
Cat #50 → T-Shirt
```

And then the user chooses a different product type for a different batch?

This distinction matters a lot because it determines how we model **Product Configurations, mockup templates, marketplace listings, and workflow inputs**.

## Prompt:
8/7/2026, 7:07:27 PM

Honestly, it's whichever one is easier. I know different marketplace providers have different things. So for example, T-Bub, you have one design, but it automatically becomes multiple different products like T-Shirt, sweatshirt, hoodie, phone case, but on Etsy, it's one product and then one medium basically. So I'm thinking the first one where it's cat number one becomes a T-Shirt product and then it also becomes a separate sweatshirt product and also comes a separate hoodie product and also becomes a separate phone case product. So I think that's the way to go for all providers. Just creating multiple products out of one design basically and then attaching a e-specific mockup for that. I also agree with all of your new suggestions about the approval boundary where each workflow stage should have a policy. I think that's good. And I think your product interface is good where you're making an abstraction over the actual marketplace listing implementation. Also another thing I want to change is I want the user to select, like, for each mockup type, like how many mockups they want to have. So, at least for the AI one, the deterministic one, I think you should probably only have one - I mean, it depends - but probably only one mockup for the deterministic version and then for the AI version, they can select how many they want, basically, to be created. So, for example, if I'm creating a cat prompt then for one design, it should be like if I select 3 mockups (t-shirt, hoodie, wall-art), For the t-shirt mockup, if I select both the derministic and AI lifestyle mockups, then one deterministic mockup gets created  And then I can select how many AI lifestyle mockups get created, but this could also be subject to change. Basically, it should just be as flexible as possible.

## Response:
8/7/2026, 7:07:27 PM

I think this actually resolves a major modeling question, and I agree with your instinct: **one source design should be capable of fanning out into many product variants.**

The key is that we shouldn't make "product" synonymous with "marketplace listing."

## The hierarchy I'd use

```text
Project
  │
  └── Batch / Workflow Run
        │
        ├── Design A
        │     │
        │     ├── Product Variant: T-Shirt
        │     │     ├── Deterministic Mockup
        │     │     ├── AI Mockup 1
        │     │     └── AI Mockup 2
        │     │
        │     ├── Product Variant: Hoodie
        │     │     ├── Deterministic Mockup
        │     │     └── AI Mockup 1
        │     │
        │     └── Product Variant: Wall Art
        │           └── ...
        │
        ├── Design B
        │     └── ...
        │
        └── Design C
              └── ...
```

Then:

```text
Product Variant
       ↓
Marketplace Adapter
       ↓
Marketplace Listing
```

So the same product variant might become:

```text
T-Shirt
 ├── Etsy Listing
 ├── TPublic Product
 └── Shopify Product
```

But the marketplace is responsible for determining how that gets represented.

---

# I would make one terminology change

I'd probably call this a **Product Variant** rather than simply Product.

Because:

```text
Design
  ↓
Product Family
  ↓
Product Variant
```

could eventually be:

```text
Cat Design #1

Product Family:
"Funny Cat Collection #1"

Variants:
├── T-Shirt
├── Hoodie
├── Sweatshirt
├── Phone Case
└── Wall Art
```

You don't necessarily need to expose "Product Family" in V1, but this conceptual distinction will make the architecture much cleaner.

---

# Your mockup idea fits beautifully into this

I think the mockup configuration should be **per product type**, not per design.

Suppose you configure:

```text
Product Types

☑ T-Shirt
☑ Hoodie
☑ Wall Art
```

Then:

### T-Shirt

```text
Deterministic
  Quantity: 1

AI Lifestyle
  Quantity: 3
```

### Hoodie

```text
Deterministic
  Quantity: 1

AI Lifestyle
  Quantity: 2
```

### Wall Art

```text
Deterministic
  Quantity: 1

AI Lifestyle
  Quantity: 4
```

Then every selected design gets:

```text
Design #1
 ├── T-Shirt
 │    ├── deterministic-01
 │    ├── ai-01
 │    ├── ai-02
 │    └── ai-03
 │
 ├── Hoodie
 │    ├── deterministic-01
 │    ├── ai-01
 │    └── ai-02
 │
 └── Wall Art
      ├── deterministic-01
      ├── ai-01
      ├── ai-02
      ├── ai-03
      └── ai-04
```

That's extremely flexible.

And importantly, **the workflow engine doesn't care whether there is one mockup or 100**.

It's just fan-out.

---

# This suggests a really nice workflow primitive

Instead of thinking:

```text
Generate Mockup
```

we can think:

```text
Generate Mockups
```

with configuration:

```ts
interface MockupGenerationConfig {
  productType: ProductType

  strategies: MockupStrategyConfig[]
}
```

Conceptually:

```ts
interface MockupStrategyConfig {
  strategy: "deterministic" | "generative"

  quantity: number

  provider?: ProviderReference

  template?: TemplateReference

  prompt?: string
}
```

So:

```text
{
  productType: "tshirt",

  strategies: [
    {
      strategy: "deterministic",
      quantity: 1,
      template: "black-tshirt-template"
    },

    {
      strategy: "generative",
      quantity: 3,
      provider: "openrouter",
      model: "..."
    }
  ]
}
```

That is exactly the kind of configuration that can evolve without rewriting the workflow system.

---

# And templates should be reusable

Imagine you have:

### "Black T-Shirt — Studio"

```text
Template
├── Product type: T-Shirt
├── Rendering: deterministic
├── Base image
├── Design region
├── Mask
├── Displacement map
└── Effects
```

Then:

### "Woman Wearing Black T-Shirt"

```text
Template
├── Product type: T-Shirt
├── Rendering: AI
├── Reference images
├── Prompt
└── Model configuration
```

You could have a template library:

```text
T-Shirts
├── Studio Front
├── Studio Back
├── Person Wearing Shirt
├── Person Outdoors
└── Lifestyle Coffee Shop

Hoodies
├── Studio Front
├── Studio Back
└── Lifestyle

Wall Art
├── Living Room
├── Bedroom
└── Office
```

And users select these at the workflow level.

---

# I think we should make one distinction here, though

There are actually **two kinds of "AI mockup" configuration**.

### AI generation as a template

User selects:

> "Woman wearing shirt in coffee shop"

and the app has a predefined prompt/reference setup.

### AI generation as a custom prompt

User says:

> "Create a photorealistic lifestyle photo of a young woman wearing this black t-shirt while walking through Tokyo at night."

So the UI could eventually offer:

```text
Mockup method

○ Deterministic
○ AI — Template
○ AI — Custom
```

And the advanced configuration can expose provider/model parameters.

That gives you a very nice progression:

**simple for most users, powerful when needed.**

---

# And I really like the "one deterministic" default

I think we should make sensible defaults rather than force the user to configure everything.

For example:

```text
T-Shirt
────────────────────────

Deterministic mockups
[✓] Studio Front             1

AI lifestyle mockups
[✓] Lifestyle                3

                    [+ Add Mockup Type]
```

Then:

```text
Hoodie
────────────────────────

Deterministic mockups
[✓] Studio Front             1

AI lifestyle mockups
[ ] Lifestyle                0
```

And perhaps the user can add multiple templates:

```text
Deterministic
  ✓ Studio Front      1
  ✓ Studio Back       1

AI
  ✓ Coffee Shop       2
  ✓ Outdoor           2
```

So we don't unnecessarily constrain the model to "one deterministic + N AI."

The general abstraction becomes:

> **A product variant has an arbitrary collection of mockup jobs.**

That is the most future-proof interpretation.

---

# There's another consequence of this that I think is important

## Mockups shouldn't necessarily be generated immediately after designs

We should have an explicit **product configuration stage**.

Something like:

```text
STEP 1
Create Designs
        ↓
STEP 2
Review Designs
        ↓
STEP 3
Configure Products
        ↓
STEP 4
Generate Mockups
        ↓
STEP 5
Generate Listings
        ↓
STEP 6
Review
        ↓
STEP 7
Publish
```

So after selecting your 37 good cat designs, you can say:

```text
Products

☑ T-Shirt
☑ Hoodie
☑ Sweatshirt
☐ Phone Case
☐ Wall Art
```

Then configure mockups.

This also means **you don't waste inference money generating mockups for designs you subsequently reject.**

That's a very important practical property.

---

# And I'd make processing stages independently rerunnable

Suppose:

```text
37 designs
 ↓
37 × 3 products
 ↓
111 products
 ↓
333 mockups
```

You don't want a failure at mockup #247 to make you restart everything.

The system should understand:

```text
Workflow Run
│
├── Design Generation
│   ├── 1 ✓
│   ├── 2 ✓
│   └── ...
│
├── Product Generation
│   ├── ...
│
├── Mockup Generation
│   ├── 1 ✓
│   ├── 2 ✓
│   ├── 3 ✗
│   └── ...
│
└── Publishing
```

Each unit of work becomes a **job**.

That will eventually push us toward a proper background job architecture rather than doing everything synchronously in Hono.

---

# This also makes your provider abstraction much more powerful

Imagine this:

```text
Remove Background
       ↓
[Provider: Fal.ai]
       ↓
       ↓
Resize
       ↓
[Provider: Sharp/local]
       ↓
       ↓
Upscale
       ↓
[Provider: Local ComfyUI]
       ↓
       ↓
Generate Mockup
       ↓
[Provider: OpenRouter]
```

And another user could have:

```text
Remove Background
       ↓
[Provider: Local RMBG]
       ↓
Resize
       ↓
[Provider: Sharp]
       ↓
Upscale
       ↓
[Provider: Fal.ai]
       ↓
Generate Mockup
       ↓
[Provider: Google/Nano Banana]
```

Same workflow.

Different infrastructure.

**That's exactly what "program to interfaces" should mean in this application.**

---

# Where I think we are now

I would currently define the conceptual domain as:

```text
Workspace
│
├── Projects
│
├── Workflows
│
├── Templates
│
├── Provider Configurations
│
├── Marketplace Connections
│
└── Runs
     │
     └── Batch
          │
          ├── Designs
          │
          ├── Product Variants
          │
          ├── Mockups
          │
          ├── Listings
          │
          └── Jobs
```

With the fundamental pipeline:

```text
Input
  ↓
Design
  ↓
Processing
  ↓
Product Variants
  ↓
Mockup Generation
  ↓
Metadata Generation
  ↓
Marketplace Listing
  ↓
Publish / Export
```

And each stage has:

```text
Provider
Configuration
Approval Policy
Retry Policy
```

That's getting very close to a genuinely good architecture rather than just a collection of features.

---

## The next thing I want to nail down: **what should the actual user experience feel like?**

We've mostly established the *engine*. Now I'd like to design the **V1 product experience** before touching the database.

Specifically, I think we should walk through one concrete scenario:

> **"I want to make 50 funny cat T-shirts and sell them on Etsy."**

Let's design the screens and interactions from the moment you open the app to the moment the Etsy listings are published.

Once we have that, we can identify:

1. the actual domain entities,
2. workflow primitives,
3. provider interfaces,
4. job/queue architecture,
5. storage architecture,
6. auth/billing,
7. marketplace architecture,
8. database schema,
9. API boundaries,
10. and finally the one-shot implementation PRD.

I think that's the right order.

## Prompt:
8/7/2026, 8:25:48 PM

I really like your AI template idea. That should be the main way to do it. Basically you just can't have the AI generate anything random. You have to create templates beforehand and then use the AI generation as a template for the actual mockups. And the user can select which templates they want to use. And basically the quantity for each template. For which templates to use etc. So that's even better flexibility I think and that will lead to even better results.  And you write, "I also like the idea of multiple templates, so multiple templates for deterministic multiple templates for AI." I also like the idea of a product configuration stage and reviewing them. I also like your idea of breaking down each unit of work into a job, and yes, background jobs for this does seem like the proper architecture, and with self-hosting we could even do something like using rabbitmq or upstash or redis jobs for this. I don't really know the product experience, so you can choose what you want rather than what I want, i can't really verbalize the user experience flow, I think you know better and will choose correctly, but here are the basic steps I'm thinking

1. user logs in via google for simplicity, because you gotta scope a user to their resources in a db
2. User sees multi-step form, each step takes care of a core part of a workflow
3. First step: user can choose from existing workflow or go ahead and create from scratch
4. 2nd step: user chooses between manually uploading funny cat designs or in this case puts in the theme "funny cat designs" into the AI prompt textarea
5. 3rd step: The user chooses the number of designs to make, or reviews uploaded image designs via image preview and can remove or add more
6. 4th step: The user chooses which mockup types to make, each mockup type has a deterministic mockup they can preview (some image placeholder replacing where the design would be on the mockup, premake these beforehand via ffmpeg and sharp), with multiple deterministic mockups perhaps per mockup type (for example, three deterministic mockups per a tshirt mockup type could include child deterministic mockup, man deterministic mockup, and woman deterministic mockup, while a phone mockup type will only have two deterministic mockups, one iphone and one samsung) and users can choose from existing AI prompt mockup templates or create their own, and to make things simple, you can use multiple quantities of a mockup template, no matter whether deterministic or ai template, defaulting to 1 each.
   7.The user chooses which AIImageProvider to use for creating the AI generated designs and AI generated mockups. Let's say they choose OpenRouter.
7. The user is prompted which marketplaces they want to upload to, and if they select a marketplace whose integration is not set up yet, they connect to it and the app does the setup, then it will be available for them to select as a marketplace target to upload to, for example they select etsy, so connect with it by authenticating with etsy, then if the integration needs additional details like maybe an API key or auth token, we give instructions for how the user should get them and give to the app, once connected to etsy, the user can now select etsy as marketplace target. If they don't select any marketplace targets, they can move to the next step
8. The user chooses which storage options they want for the mockups, by default designs and mockups will be permanently stored in a connected-app blob storage solution like S3 bucket or cloudinary (connected to the app, shown in mockups and design gallery in the UI that the user sees), or they can additionally select google drive, and they authenticate to allow access to create a folder that designs and mockups are also uploaded to google drive, but if online, the designs and mockups will always be uploaded to a bucket storage solution, and if self-hosting, that can be either bucket storage or additional filesystem option pops up.
9. Then the user choose the image transformation pipeline they want based on which marketplaces they select as targets since they require different image dimensions and designs, and they also select for each iamge transformation, a specific provider, like maybe imagekit for all transformations, cloudinary for all transformations, removebg model for removing backgroudn transformation, or sharp for everything but removing background. Let's say for etsy, the main listing image should be x by x dimensions and then all other mockups must be y by y dimensions, so now after multiple all the mockup type and mockup template combinations per design image are created, they would then go through this image processing pipeline to create multiple image sizes. For transformations applied to the main design regardless of what marketplaces you're targeting before its processed for mockup creation, background removal is available, but for now, I don't think background removal makes sense for mockups, but for simplicity, you can leave that on as well. The option will always be available of creating one pipeline for post-processing of the designs after AI creates them
10. The user can confirm that the workflow looks good and go back to any previous step to change it, and then create it. and now the user triggers the workflow, waits a while for the background task to complete and can check in at any point to view the progress or even retry failed jobs.
11. Once the workflow is completed, they can go the workflow completed page to see the specific workflow details, where for each design and mockup type combination, if the user targeted a specific marketplace(s), they would be able to preview what the listing would look like for that specific marketplace for each design, where a single design would be multiple products, and they can view the mockups for each one, something like a workflows/\:workflowId/etsy/design-01 route where now the user can view all the preview etsy listings created from design-01 file, including the mockup image, product descriptionand title  that a dumb and fast AI makes from visually looking at the image, and main listing image. For each individual product, the user has the choice of making it a draft lsiting on etsy or directly publishing it, or a giant bulk button that uploads every single design and its associated products for a specific marketplace as a draft listing. They can also download a structured zip file of all the designs and mockups.

Obviously, I never really made this kind of automation before, and I've agreed with every single one of your points, so trust yourself more than this random rambling, prefer your workflow and ideas if you want to fit this UX in, rather than contorting what you ideated that would probably work to fit my shabby idea of what the UX would be, be brutally honest to make this the best possible product for me and be able to grow it into something larger in the future.

## Response:
8/7/2026, 8:25:50 PM

I think you have given me enough to make a much stronger call on the UX. And yes: **I would substantially simplify and reorganize your proposed flow.**

Your ideas are good, but right now you're exposing too many implementation/configuration decisions to the user *before they even know what they're making*. That would make the app feel like an orchestration platform rather than a product-production tool.

The architecture underneath should be extremely sophisticated. **The UX should not be.**

My guiding principle would be:

> **Simple by default, configurable everywhere, advanced configuration only when you ask for it.**

And I would make one other major change:

> **The user should create a "production workflow" through a guided builder, but the resulting workflow should become a reusable, editable object.**

So let's design the actual experience.

---

# The V1 experience I'd build

I'd structure the application around four major concepts:

```text
Workspace
   │
   ├── Workflows
   │
   ├── Assets
   │
   ├── Templates
   │
   └── Connections
```

And then:

```text
Workflow
   │
   └── Run
         │
         ├── Designs
         ├── Products
         ├── Mockups
         ├── Listings
         └── Jobs
```

The user primarily interacts with **Workflows** and **Runs**.

---

# The home screen

Don't immediately throw the user into a workflow builder.

I'd make the dashboard something like:

```text
┌───────────────────────────────────────────────────────────┐
│ POD Automator                              [+ New Workflow]│
├───────────────────────────────────────────────────────────┤
│                                                           │
│ Recent Workflows                                          │
│                                                           │
│ Funny Cat T-Shirts                         Last run: today │
│ 50 designs · Etsy · 150 products                          │
│ [Run Again] [Edit]                                        │
│                                                           │
│ JavaScript Developer Shirts                Last run: 2d   │
│ 25 designs · Etsy                                       │
│ [Run Again] [Edit]                                        │
│                                                           │
│ ───────────────────────────────────────────────────────── │
│                                                           │
│ Templates              Connections             Assets     │
│ 12 mockup templates    Etsy ✓                 482 designs │
│ 8 workflows            Google Drive ✓          ...        │
└───────────────────────────────────────────────────────────┘
```

The primary CTA:

**Create Workflow**

---

# Step 1 — Choose how to start

This is one place where I agree with your idea almost exactly.

```text
How would you like to start?

┌──────────────────────┐
│ Start from scratch   │
│ Build a new workflow │
└──────────────────────┘

┌──────────────────────┐
│ Use existing workflow│
│ Start from a saved   │
│ workflow              │
└──────────────────────┘
```

But I would add:

```text
┌──────────────────────┐
│ Use a template       │
│ Start with a          │
│ recommended workflow │
└──────────────────────┘
```

Eventually you might have:

> "AI T-Shirts → Etsy"

> "Upload Designs → Etsy"

> "AI Designs → Multi-Marketplace"

> "Designs → Mockups Only"

That makes the system much easier to use.

---

# Step 2 — Define the source

I would **not** call this "AI generation."

Call it:

## Design Source

```text
How will you create your designs?

○ Generate with AI

○ Upload existing designs
```

### If AI:

```text
Describe the collection

┌──────────────────────────────────────────────┐
│ Funny cat t-shirt designs                    │
│                                              │
│ Cute, funny, slightly absurd internet-style  │
│ humor. Designs should work well on shirts.   │
└──────────────────────────────────────────────┘

Number of designs: [50]

Variation:
[●] Automatically vary designs
[ ] Keep style highly consistent
```

And here's something I think we should add:

### Reference images

```text
Reference images (optional)

[ + Add reference images ]
```

Because eventually you will want:

> "Make 50 designs in this style."

That's hugely useful for AI generation.

---

# Step 3 — Generate/review designs

This should be a **real checkpoint**, not just another form page.

The system runs the generation jobs.

Then:

```text
50 designs generated

[Select All] [Deselect All]

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ IMG  │ │ IMG  │ │ IMG  │ │ IMG  │
│  ✓   │ │  ✓   │ │  ✕   │ │  ✓   │
└──────┘ └──────┘ └──────┘ └──────┘

1–4 of 50

Selected: 47
```

You can:

- inspect an image
- delete it
- regenerate it
- upload additional designs
- reorder them
- select/deselect

This is important because **AI generation shouldn't be treated as trusted input**.

The user explicitly approves the design set before expensive downstream operations.

---

# Step 4 — Product configuration

This is where I would improve your proposed UX considerably.

Don't ask:

> "Which mockup types?"

Ask:

# What products should these designs become?

```text
Select products

☑ T-Shirt
☑ Sweatshirt
☑ Hoodie
☐ Phone Case
☐ Wall Art
☐ Tote Bag

                         [Customize]
```

This creates the product variants.

So:

```text
50 designs × 3 product types
= 150 product variants
```

And show that number immediately:

> **150 products will be created**

That's a really useful piece of feedback.

---

# Step 5 — Configure mockups

Now we're dealing with **products**, not designs.

For each product type:

```text
T-Shirt
──────────────────────────────────────

Deterministic Mockups

☑ Woman wearing shirt
☑ Man wearing shirt
☐ Child wearing shirt

AI Mockup Templates

☑ Coffee shop
☑ Outdoor lifestyle
☐ Studio
```

Each template has a quantity:

```text
Woman wearing shirt        [1]
Man wearing shirt          [1]

Coffee shop                [3]
Outdoor lifestyle          [2]
```

And the UI should say:

> **7 mockups per T-shirt**

The default should probably be:

```text
1 deterministic
+
1 AI
```

rather than making people configure everything.

---

# And this is where your template insight is extremely important

I completely agree with your latest correction:

> **AI should not be allowed to freely generate arbitrary mockups in the production workflow.**

Instead:

```text
AI Mockup Template
│
├── Name
├── Product type
├── Prompt
├── Reference images
├── Provider
├── Model
├── Generation settings
└── Output configuration
```

Example:

### "Woman Wearing T-Shirt — Coffee Shop"

```text
Product: T-Shirt

Prompt:
Photorealistic lifestyle photograph of a woman
wearing the provided t-shirt design...

Reference:
[person reference]
[shirt reference]

Provider:
OpenRouter

Model:
Nano Banana
```

Then the workflow says:

```text
Use template "Woman Wearing T-Shirt — Coffee Shop"
Quantity: 3
```

This is **much safer and more reproducible** than allowing arbitrary prompts during each production run.

---

# But I'd allow template overrides

Suppose the user chooses:

> Coffee Shop

They could click:

**Customize**

and temporarily modify:

```text
Prompt:
"Make the scene feel like a cozy Japanese coffee shop."

Quantity:
5

Provider:
OpenRouter

Model:
...
```

But importantly:

> **Customize for this run**

doesn't modify the underlying reusable template unless the user explicitly chooses:

> **Save as new template**

That's a very nice UX pattern.

---

# Step 6 — Image processing

I would actually move this **earlier in the conceptual pipeline**, but hide most of it.

The user shouldn't have to think:

> "Should I use Sharp or ImageKit?"

That's implementation detail.

Instead:

# Prepare designs

```text
Design processing

☑ Remove background
☑ Normalize dimensions
☑ Convert to PNG
☑ Upscale when needed
```

Then:

**Advanced settings**

```text
Background Removal
Provider: [Fal.ai ▼]
Model: [RMBG ▼]

Resize
Provider: [Sharp ▼]

Upscaling
Provider: [Fal.ai ▼]
Model: [...]
```

The default providers come from the user's global provider configuration.

This is one of the places where **configuration defaults** will make the app dramatically nicer.

---

# Important: Marketplace requirements should drive this

You had a very good idea here.

The workflow knows:

```text
Targets:
☑ Etsy
☑ TPublic
```

The marketplace adapters declare their requirements:

```text
Etsy
├── image requirements
├── product metadata
├── category requirements
└── listing requirements

TPublic
├── image requirements
├── product configuration
└── metadata requirements
```

The application can then automatically determine:

> "These products need these transformations."

Rather than asking the user to manually configure every image dimension.

That's a major architectural principle I'd put into the PRD:

> **Marketplace adapters declare their asset and listing requirements; workflows satisfy those requirements through configurable transformation pipelines.**

So the user can still override them, but the happy path is automatic.

---

# Step 7 — Marketplace targets

I would put this **after product configuration and before final review**, rather than making it one of the earliest decisions.

```text
Where do you want to sell?

☑ Etsy
☐ TPublic
☐ Shopify
☐ Export only
```

If Etsy isn't connected:

```text
Etsy

Not connected

[Connect Etsy]
```

Clicking that initiates OAuth.

Afterward:

```text
✓ Etsy connected
```

And the user continues.

---

# One subtle change I'd make

Don't force marketplace configuration to happen during every workflow.

Instead:

### Connections are global.

```text
Settings → Connections

Etsy ✓
Google Drive ✓
Fal.ai ✓
OpenRouter ✓
AWS S3 ✓
```

Then the workflow merely says:

```text
Targets:
☑ Etsy
☑ Google Drive
```

That keeps credentials and integrations out of the workflow itself.

The workflow references a connection.

---

# Step 8 — Storage

Again, I'd hide most of this.

The default should simply be:

> **Your generated assets will be stored in your configured storage.**

Then:

```text
Storage

Primary storage
● S3
○ Local filesystem

Additional exports
☐ Google Drive
```

For self-hosted:

```text
Primary storage
● Local filesystem
○ S3-compatible storage
```

And your architecture can support:

```text
StorageProvider
├── S3
├── Cloudinary
├── LocalFilesystem
├── GoogleDrive
└── ...
```

One correction, though:

**I wouldn't make Cloudinary the conceptual equivalent of S3.**

Cloudinary is more of an asset/media management + transformation platform, whereas S3 is fundamentally object storage.

You can support both, but their provider interfaces may not be identical.

That's another case where we should program to **capabilities**, not force everything into one giant interface.

---

# Step 9 — Review

This is where I would combine your proposed final confirmation screen with a much more useful "production plan."

Something like:

# Production Plan

```text
Funny Cat T-Shirts

50 designs
×
3 product types
=
150 products

Mockups:

T-Shirt
  2 deterministic
  5 AI
  = 7 × 50

Hoodie
  1 deterministic
  3 AI
  = 4 × 50

Sweatshirt
  1 deterministic
  2 AI
  = 3 × 50

──────────────────────────

Estimated outputs:
150 products
700 mockup images

Destinations:
✓ Etsy
✓ Google Drive

Design provider:
OpenRouter / Nano Banana

Mockup providers:
Sharp / deterministic
OpenRouter / AI

Processing:
✓ Background removal
✓ Resize
✓ PNG conversion
✓ Upscale
```

Then:

# Estimated usage

If the providers expose pricing:

> Estimated AI cost: **$X–$Y**

This could be incredibly valuable.

You're about to launch 50 × 3 products × several AI generations.

The user should know that.

---

# Then one big button

**Start Production**

And *this* is where the workflow becomes a background job.

---

# The run experience

After clicking it, don't just show a spinner.

Take them to:

```text
/workflows/:workflowId/runs/:runId
```

with a real production dashboard.

```text
Funny Cat T-Shirts
Run #3

Overall
████████████████░░░░ 78%

Design generation       ✓ 50/50
Design processing       ✓ 50/50
Product creation        ✓ 150/150
Mockup generation       ███████████░░ 380/450
Metadata generation     ████████░░░░ 120/150
Etsy preparation        ░░░░░░░░░░░░ 0/150
```

And below:

```text
Jobs

✓ 421 completed
⟳ 8 running
✕ 3 failed
○ 18 queued

[View Failed Jobs]
```

---

# And failures should be first-class

Suppose one AI request fails.

Don't kill the workflow.

```text
Mockup #381
Failed

Provider: OpenRouter
Model: Nano Banana

Error:
Rate limit exceeded

[Retry]
[Retry with another provider]
[Skip]
```

That second button is particularly interesting.

Because your provider abstraction means you can potentially say:

> **Retry with fallback provider**

and the job gets routed to another implementation.

That's a legitimate advantage of your architecture.

---

# Completed workflow

Then:

```text
/workflows/:workflowId/runs/:runId
```

becomes a production dashboard.

You could have:

```text
Overview
Designs
Products
Mockups
Listings
Jobs
Files
```

---

# Marketplace view

I **really like** your Etsy-specific preview idea, but I'd make it generic.

Instead of:

```text
/workflows/:workflowId/etsy/design-01
```

I'd conceptually have:

```text
/runs/:runId/marketplaces/etsy/products/...
```

because Etsy is simply one marketplace adapter.

The UI can look like Etsy:

```text
Etsy Preview

┌────────────────────────────────────────┐
│                                        │
│         [MAIN LISTING IMAGE]           │
│                                        │
├────────────────────────────────────────┤
│ Funny Cat Coding T-Shirt               │
│                                        │
│ $29.99                                 │
│                                        │
│ [mockup] [mockup] [mockup] [mockup]    │
│                                        │
│ Description                            │
│ -------------------------------------  │
│ This hilarious...                      │
│                                        │
│ Tags                                   │
│ funny cat, coding shirt, ...           │
└────────────────────────────────────────┘

[Save as Draft] [Publish]
```

And:

> **Publish all 150 products**

or:

> **Create all as drafts**

That's exactly the right place for the marketplace adapter to shine.

---

# I would strongly favor "draft first" as the default

You said you want automatic publishing.

That's fine.

But for the **default policy**, I'd probably choose:

> **Create drafts**

rather than immediately publishing.

Then the user can change the workflow's approval policy:

```text
Publishing policy

○ Always create drafts
● Publish automatically
○ Ask me before publishing
```

Why?

Because the expensive mistake isn't:

> "I had to click Publish."

The expensive mistake is:

> "I accidentally published 150 garbage listings."

Your approval boundary solves this elegantly.

---

# Your ZIP export is absolutely a feature

And it should be structured.

Something like:

```text
funny-cat-tshirts/
│
├── designs/
│   ├── cat-001.png
│   ├── cat-002.png
│   └── ...
│
├── products/
│   ├── cat-001/
│   │   ├── tshirt/
│   │   │   ├── mockup-01.png
│   │   │   ├── mockup-02.png
│   │   │   └── listing.json
│   │   │
│   │   ├── hoodie/
│   │   └── sweatshirt/
│   │
│   └── ...
│
├── marketplaces/
│   ├── etsy/
│   │   ├── cat-001-tshirt.json
│   │   └── ...
│   │
│   └── ...
│
└── manifest.json
```

That `manifest.json` could contain provenance:

```json
{
  "workflow": "...",
  "run": "...",
  "generatedAt": "...",
  "designs": [...],
  "products": [...],
  "mockups": [...]
}
```

That makes the export much more useful than simply dumping 500 PNGs into a ZIP.

---

# One thing I would NOT do in V1

I would **not** build a visual node-based workflow editor.

At least not initially.

It sounds cool:

```text
[AI] → [BG Removal] → [Upscale] → [Mockup] → [Etsy]
```

But it's a huge UX and engineering surface.

Instead, build the underlying workflow representation so that it **could eventually support one**.

The first UI is a wizard.

Later:

> **Advanced → Open Workflow Editor**

Then you can expose the exact same underlying workflow graph.

This is one of those cases where:

> **Build the abstraction now; don't necessarily expose the abstraction now.**

---

# And there's one more architectural idea I think is going to become very important

## Providers should be configurable globally, but overridable locally.

Imagine:

### Global settings

```text
AI Image Generation
Default: OpenRouter
Model: Nano Banana

Background Removal
Default: Fal.ai

Upscaling
Default: Fal.ai

Storage
Default: S3
```

Then workflow:

```text
AI Generation
Use: Default

Background Removal
Use: Default

Mockup Template
Use template's provider
```

But advanced users can say:

```text
AI Generation
Override → Local ComfyUI
```

And a template can itself say:

```text
Mockup Provider
Use template default
```

This gives us a hierarchy:

```text
System defaults
      ↓
Workspace defaults
      ↓
Workflow overrides
      ↓
Template overrides
      ↓
Run overrides
```

That is incredibly powerful while still allowing the normal user to simply select:

> **OpenRouter**

and move on.

---

# So I think our architecture is starting to crystallize

The major domain objects are looking like:

```text
User
Workspace
Connection
Provider
ProviderConfiguration

Workflow
WorkflowVersion
WorkflowStep
WorkflowRun

Batch
Design
Product
ProductVariant

MockupTemplate
MockupJob
MockupAsset

TransformationPipeline
TransformationStep

Marketplace
MarketplaceConnection
MarketplaceListing

StorageProvider
StoredAsset

Job
JobAttempt
```

We don't need to blindly turn every one of those into a database table yet. Some are domain concepts rather than persistence entities.

But that's a **much better starting point** than beginning with "users, products, Etsy listings, images."

---

# And I think the core engine is actually this

At the highest level:

```text
                    WORKFLOW
                       │
                       ▼
                     RUN
                       │
                       ▼
                     JOBS
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Designs      Products     Listings
          │            │            │
          └───────┬────┘            │
                  ▼                 │
               Mockups              │
                  │                 │
                  └────────┬────────┘
                           ▼
                       Marketplace
```

And jobs are executed through capability interfaces:

```text
Job
 ↓
Capability
 ↓
Provider
 ↓
External service / local implementation
```

That gives you the future-proof architecture you were looking for.

---

# I think we're ready for the next phase

Before we jump into the database, I want to resolve **one architectural question that will affect almost everything else**:

## How much of the workflow should be generated dynamically?

I see two possible models.

### Model A — Fixed production pipeline

Every workflow essentially follows:

```text
Design
→ Process
→ Products
→ Mockups
→ Metadata
→ Marketplace
```

Users configure each stage, but can't radically rearrange it.

**Pros:** Much simpler, excellent UX, easier to make reliable.

### Model B — General workflow engine

A workflow is fundamentally an arbitrary directed graph:

```text
Input
 ↓
AI
 ↓
Transform
 ├→ Mockup A
 └→ Mockup B
       ↓
    Metadata
       ↓
    Etsy
```

Users can eventually add/reorder/branch arbitrary steps.

**Pros:** Extremely future-proof and could eventually become a general AI asset automation platform.

### My recommendation

**Implement the engine as Model B, expose the UX as Model A.**

In other words:

> The backend is a general workflow/job engine, while the initial UI is a constrained POD production wizard that produces valid workflows.

That gives us the best of both worlds.

And I think **that should be one of the central architectural decisions in the eventual PRD**.

If you agree with that direction, I think the next conversation should be much more technical: we can design the **workflow execution model, provider interfaces, job system, asset/provenance model, and storage architecture** before we touch specific technologies like Deno/Hono, Drizzle, Neon, Redis/RabbitMQ, Better Auth/Clerk, etc.

## Prompt:
8/7/2026, 8:30:07 PM

Yes, I agree with every recommendation you made

## Response:
8/7/2026, 8:30:07 PM

Excellent. Then I think we have enough product intent to **lock the high-level direction** rather than continuing to brainstorm features indefinitely.

The key decisions so far are:

- **POD production automation**, not merely a mockup generator.
- **Design → product variants → mockups → metadata → marketplace listings** is the core lifecycle.
- One design can fan out into multiple product variants.
- Mockups are configured through reusable **deterministic and AI mockup templates**.
- AI mockups are **template-driven**, not arbitrary one-off generations.
- Every stage can have an **approval policy**.
- Every unit of work is a **background job** and can independently retry/fail.
- The underlying engine is a **general workflow graph**, while V1 exposes a much simpler guided POD wizard.
- Providers are implementations behind **capability interfaces**, never hardcoded into domain logic.
- Marketplace integrations are adapters.
- Storage is an abstraction.
- Local/self-hosted and cloud deployments use the same application.
- Marketplace requirements can drive image-processing requirements automatically.
- Workflows are reusable/versioned; individual executions are **runs**.
- Assets retain provenance.
- The system should eventually support arbitrary providers, marketplaces, transformations, and AI models without redesigning the core.
- V1 should optimize for **your own workflow first**, while laying the foundation for a larger product.

### The next phase should be architecture, not more UX

I'd propose we now work through these in order:

1. **Domain model** — what each object actually means and how they relate.
2. **Workflow model** — how the general graph is represented and executed.
3. **Job system** — queues, retries, concurrency, idempotency, progress, failure handling.
4. **Provider architecture** — exact interfaces for image generation, editing, transformations, mockups, storage, marketplaces, etc.
5. **Asset/provenance model** — how generated files, transformations, and lineage are represented.
6. **Marketplace abstraction** — Etsy first, but without making Etsy part of the core domain.
7. **Storage architecture** — S3, local filesystem, Google Drive, etc.
8. **Auth/configuration/secrets** — Google login, provider credentials, marketplace OAuth, self-hosting.
9. **Cloud vs. self-hosted architecture** — Deno/Hono, Postgres, queue infrastructure, Docker Compose.
10. **Database schema and API boundaries.**
11. **V1 implementation scope** — ruthlessly separating what we actually build from future abstractions.
12. **Final one-shot coding-agent PRD** — detailed enough that an agent can implement the whole thing coherently.

And one thing I particularly want to preserve is the principle we've arrived at:

> **The implementation should be more general than the initial product experience.**

So the codebase can eventually become a general-purpose asset-production automation platform, while the first version simply feels like:

**"Give me 50 designs → make products → make mockups → publish them."**

That's a very strong foundation for a vibe-coded app because we're defining the **intent and boundaries** before specifying implementation details.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)
