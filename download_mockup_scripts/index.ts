import { mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import sharp from "sharp";

const category = process.argv[2];

if (!category) {
  console.error("Please provide a category name (e.g., phone, canvas, hoodies, posters)");
  process.exit(1);
}

const INPUT_JSON = join(import.meta.dir, `../mockup_image_templates/${category}.json`);
const OUTPUT_DIR = join(import.meta.dir, `../download_mockups/${category}`);

function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove non-alphanumeric except spaces and hyphens
    .replace(/[\s_]+/g, "-")  // Replace spaces and underscores with hyphens
    .replace(/-+/g, "-")      // Replace multiple hyphens with one
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

async function downloadImages() {
  try {
    // 1. Load JSON
    const data = JSON.parse(await readFile(INPUT_JSON, "utf-8"));
    
    // 2. Ensure output directory exists
    await mkdir(OUTPUT_DIR, { recursive: true });
    
    console.log(`Starting download of ${data.length} images...`);

    for (const item of data) {
      const { src, title } = item;
      if (!src || !title) continue;

      const filename = `${sanitizeFilename(title)}.webp`;
      const outputPath = join(OUTPUT_DIR, filename);

      console.log(`Downloading: ${title} -> ${filename}`);

      try {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${src}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await sharp(buffer)
          .webp({ quality: 80 })
          .toFile(outputPath);

        console.log(`Successfully saved: ${filename}`);
      } catch (err) {
        console.error(`Error processing ${title}:`, err);
      }
    }

    console.log("All finished!");
  } catch (error) {
    console.error("Critical error:", error);
  }
}

downloadImages();
