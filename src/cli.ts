import crypto from "crypto";
import axios from "axios";
import fs, { writeFileSync } from "fs";
import "dotenv/config";
import { OpenAI } from "openai";
import readline from "readline";
import inquirer from "inquirer";
import { join } from "path";

export interface HomeAssistantEntity {
  entity_id: string;
  attributes: Record<string, any>; // empty in your example, but usually has key-value pairs
  last_changed: string; // ISO 8601 timestamp
  last_reported: string; // ISO 8601 timestamp
  last_updated: string; // ISO 8601 timestamp
}


const HA_URL = process.env.HOME_ASSISTANT_URL;
const HA_TOKEN = process.env.HOME_ASSISTANT_TOKEN;
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const defaultPrompt = `Describe the image naturally, as if you're telling a friend what you see. Mention who’s in it, what they look like, and what they might be doing or feeling. If there are people in the photo please describe them in detail. Tell me their hair colour, eye colour, clothing, and any other notable features. `;

if (!HA_URL || !HA_TOKEN || !SNAPSHOT_PATH || !OPENAI_API_KEY) {
  console.error("❌ Missing required environment variables. Please check the README and add a .env file with the necessary configuration.");
  process.exit(1);
}

async function getEntityStates(): Promise<HomeAssistantEntity[]> {
  const entityStates = (await homeAssistantRequest<HomeAssistantEntity[]>("/api/states"));
  const outputDir = join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const entityStatesFile = join(outputDir, 'enity-states.json');
  fs.writeFileSync(entityStatesFile, JSON.stringify(entityStates, null, 2));
  return entityStates;
}

function getEntity(entityStates: HomeAssistantEntity[], entityId: string) : HomeAssistantEntity | undefined {
  return entityStates.find(e => e.entity_id === entityId);
}

async function getPhotoFile(entity: HomeAssistantEntity) {
  if (entity) {
    const photoUrl = entity.attributes?.entity_picture;
    return await saveCameraSnapshot(photoUrl);
  }
  return undefined
}

function getFileAsBase64(filePath: string): string {
  const imageData = fs.readFileSync(filePath);
  const base64Image = imageData.toString('base64');
  return base64Image;
}

async function homeAssistantRequest<TResponse = any>(path: string): Promise<TResponse> {

  const url = HA_URL + path;
  try {
    return (await axios.get(url, {
      headers: {
        Authorization: `Bearer ${HA_TOKEN}`,
        "Content-Type": "application/json",
      },
    })).data as TResponse;
  } catch (error: any) {
    throw new Error(`Error connecting to Home Assistant: ${url} - ${error.message}`);
    
  }
}

async function saveCameraSnapshot(entityPicturePath: string): Promise<string | undefined> {
  const url = `${HA_URL}${entityPicturePath}`;

  // Try to extract the entity name from the URL (e.g., /api/camera_proxy/camera.front_door?...)
  let entityName = 'unknown';
  const match = entityPicturePath.match(/camera\.([\w_]+)/);
  if (match && match[1]) {
    entityName = match[1];
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputFilePath = join(outputDir, `snapshot_${entityName}_${timestamp}.jpg`);

  console.log(`Attemping to download ${url}`);

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${HA_TOKEN}`,
      },
    });
    console.log(`✅ Downloaded ${url}`);
    writeFileSync(outputFilePath, response.data);
    console.log(`✅ Image saved to ${outputFilePath}`);
    return outputFilePath;
  } catch (error: any) {
    console.error('❌ Failed to download image:', error.message);
  }
}

async function triggerSnapshot(entity: HomeAssistantEntity): Promise<void> {
  const url = `${HA_URL}/api/services/camera/snapshot`;
  const payload = {
    entity_id: entity.entity_id,
    filename: `/config/www/${(SNAPSHOT_PATH as string).replace(/^\/local\//, '')}`,
  };

  try {
    await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${HA_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ Snapshot triggered');
  } catch (err: any) {
    const msg = err.response?.statusText || err.message;
    throw new Error(`❌ Failed to trigger snapshot: ${msg}`);
  }
}

async function connectToHomeAssistant(): Promise<boolean> {
  try {
    await homeAssistantRequest("/api/");
  } catch (error) {
    console.error("❌ Error connecting to Home Assistant:", error);
    return false;
  }

  console.log("✅ Home Assistant is available.");

  return true;
}

async function main() {
  // Connect to Home Assistant
  await connectToHomeAssistant();

  // Get the entity states
  const entityStates = await getEntityStates();

  // Filter for camera entities
  const cameraEntities = entityStates.filter(e => e.entity_id && e.entity_id.startsWith('camera.'));
  if (cameraEntities.length === 0) {
    console.log('No camera entities found.');
    process.exit(1);
  }


  // Prompt user to select multiple cameras
  const cameraPrompt: any = [
    {
      type: 'checkbox',
      name: 'selectedCameras',
      message: 'Select one or more camera entities:',
      choices: cameraEntities.map(e => ({ name: e.entity_id, value: e.entity_id })),
      validate: (input: string[]) => input.length > 0 ? true : 'Please select at least one camera.'
    }
  ];
  const { selectedCameras } = await inquirer.prompt(cameraPrompt);

  // Prompt user for interval
  const intervalPrompt: any = [
    {
      type: 'list',
      name: 'interval',
      message: 'How often do you want to check the camera(s)?',
      choices: [
        { name: 'Every 1 minute', value: 1 },
        { name: 'Every 5 minutes', value: 5 },
        { name: 'Every 10 minutes', value: 10 },
      ],
      default: 1
    }
  ];
  const { interval } = await inquirer.prompt(intervalPrompt);

  const apiKey = process.env.OPENAI_API_KEY;
  const openai = new OpenAI({ apiKey });

  async function processCameras() {
    for (const entityId of selectedCameras) {
      try {
        const entity = getEntity(entityStates, entityId);
        if (!entity) {
          console.error(`❌ Entity ${entityId} not found.`);
          continue;
        }

        try {
          await triggerSnapshot(entity);
        } catch (err) {
          console.error(`❌ Failed to trigger snapshot for ${entityId}:`, err);
          // Continue to try downloading the image anyway
        }

        let filePath: string | undefined;
        try {
          filePath = await getPhotoFile(entity);
          if (!filePath) throw new Error('No file path returned');
        } catch (err) {
          console.error(`❌ Failed to retrieve photo for entity ${entityId}:`, err);
          continue;
        }

        // Find the most recent previous snapshot for this entity
        const outputDir = join(__dirname, 'output');
        let entityName = entityId.replace('camera.', '');
        let previousSnapshots: string[] = [];
        try {
          previousSnapshots = fs.readdirSync(outputDir)
            .filter(f => f.startsWith(`snapshot_${entityName}_`) && f.endsWith('.jpg'))
            .sort()
            .reverse();
        } catch (err) {
          // ignore dir read errors
        }

        let isSame = false;
        if (previousSnapshots.length > 1) {
          // The first is the current, the second is the previous
          const prevFile = join(outputDir, previousSnapshots[1]);
          try {
            const prevBuffer = fs.readFileSync(prevFile);
            const currBuffer = fs.readFileSync(filePath);
            // Compare hashes for efficiency
            const prevHash = crypto.createHash('sha256').update(prevBuffer).digest('hex');
            const currHash = crypto.createHash('sha256').update(currBuffer).digest('hex');
            if (prevHash === currHash) {
              isSame = true;
              // Delete the previous file if it's the same as the new one
              try {
                fs.unlinkSync(prevFile);
                console.log(`🗑️ Deleted previous identical snapshot for ${entityId}: ${prevFile}`);
              } catch (delErr) {
                console.error(`❌ Failed to delete previous identical snapshot for ${entityId}:`, delErr);
              }
            }
          } catch (err) {
            // ignore file read errors
          }
        }

        if (isSame) {
          console.log(`No new updates for ${entityId}: latest snapshot is identical to previous (previous deleted).`);
          continue;
        }

        // Read and encode the image as base64
        let base64Image: string;
        try {
          base64Image = getFileAsBase64(filePath);
        } catch (err) {
          console.error(`❌ Failed to read image file for ${entityId}:`, err);
          continue;
        }

        try {
          let messages: any[] = [
            { role: "system", content: "You are a helpful assistant." },
            {
              role: "user",
              content: [
                { type: "text", text: defaultPrompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`,
                  },
                },
              ],
            }
          ];

          const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
          });
          
          const response = chatCompletion.choices[0]?.message?.content;
          console.log(`\nOpenAI response for ${entityId}:\n${response}`);

          // Send notification to Home Assistant device 'Pixel 9 Pro XL', splitting if longer than 240 chars
          try {
            const notifyUrl = `${HA_URL}/api/services/notify/mobile_app_pixel_9_pro_xl`;
            const maxLen = 240;
            const msg = response || 'No description returned.';
            // Split the message into chunks of maxLen
            for (let i = 0; i < msg.length; i += maxLen) {
              const chunk = msg.slice(i, i + maxLen);
              const notifyPayload = {
                message: chunk,
                title: `Camera update: ${entityId}${msg.length > maxLen ? ` (part ${Math.floor(i / maxLen) + 1})` : ''}`,
                data: {
                  channel: 'alert',
                  importance: 'max',
                  ttl: 0,
                  priority: 'high',
                  notification: {
                    style: 'bigtext',
                    bigText: chunk
                  }
                }
              };
              await axios.post(notifyUrl, notifyPayload, {
                headers: {
                  'Authorization': `Bearer ${HA_TOKEN}`,
                  'Content-Type': 'application/json',
                },
              });
              console.log(`✅ Notification sent to Pixel 9 Pro XL${msg.length > maxLen ? ` (part ${Math.floor(i / maxLen) + 1})` : ''}.`);
            }
          } catch (err) {
            console.error(`❌ Failed to send notification for ${entityId}:`, err);
          }
        } catch (err) {
          console.error(`❌ OpenAI API error for ${entityId}:`, err);
          continue;
        }
      } catch (err) {
        console.error(`❌ Unexpected error for ${entityId}:`, err);
        continue;
      }
    }
  }

  // Run the process at the selected interval
  console.log(`\nStarting camera check every ${interval} minute(s). Press Ctrl+C to stop.\n`);
  await processCameras();
  setInterval(processCameras, interval * 60 * 1000);
}

main();





