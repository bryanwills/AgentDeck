import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const sourceDir = '/Users/puritysb/Desktop/agentdeck-0719';
const destDir = '/Users/puritysb/github/AgentDeck/docs/media';

// Ensure destination directory exists
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const tasks = [
  {
    name: 'LenovoTab_screenshot.jpg',
    src: 'IMG_9695.jpeg',
    rotate: 0,
    crop: { width: 1160, height: 550, left: 20, top: 160 },
  },
  {
    name: 'android-eink.jpg',
    src: 'IMG_9685.jpeg',
    rotate: 0,
    crop: { width: 950, height: 450, left: 125, top: 220 },
  },
  {
    name: 'inkdeck.jpg',
    src: 'IMG_9680.jpeg',
    rotate: 0,
    crop: { width: 880, height: 417, left: 160, top: 180 },
  },
  {
    name: 'ttgo.jpg',
    src: 'IMG_9702.jpeg',
    rotate: 90, // rotate 90 degrees clockwise
    crop: { width: 800, height: 380, left: 50, top: 410 }, // crop from the rotated image (900x1200)
  },
  {
    name: 'tc001.jpg',
    src: 'IMG_9698.jpeg',
    rotate: 0,
    crop: { width: 900, height: 426, left: 150, top: 350 },
  },
  {
    name: 'pixoo64.jpg',
    src: 'IMG_9700.jpeg',
    rotate: 0,
    crop: { width: 800, height: 380, left: 200, top: 260 },
  }
];

async function run() {
  for (const task of tasks) {
    const srcPath = path.join(sourceDir, task.src);
    const destPath = path.join(destDir, task.name);
    
    if (!fs.existsSync(srcPath)) {
      console.warn(`Source file not found: ${srcPath}`);
      continue;
    }
    
    try {
      let pipeline = sharp(srcPath);
      
      if (task.rotate) {
        pipeline = pipeline.rotate(task.rotate);
      }
      
      pipeline = pipeline.extract(task.crop).resize(800, 380);
      
      await pipeline.jpeg({ quality: 85 }).toFile(destPath);
      console.log(`Successfully created ${task.name} from ${task.src}`);
    } catch (err) {
      console.error(`Failed to process ${task.src} for ${task.name}:`, err);
    }
  }
}

run();
