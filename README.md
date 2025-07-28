npx mycli
npm start


# Ring AI CLI

**Note: This project is an experimental proof of concept.**

Ring AI CLI is a TypeScript Node.js command-line tool for monitoring and describing smart home camera snapshots using Home Assistant and OpenAI. It connects to your Home Assistant instance, lets you select cameras, triggers snapshots, compares images, and uses OpenAI to generate natural language descriptions of what’s in each photo. It can also send notifications to your mobile device with the generated descriptions.

## Features
- Connects to Home Assistant and lists available camera entities
- Triggers camera snapshots and saves images
- Compares new snapshots to previous ones to avoid duplicates
- Uses OpenAI to describe images in natural language
- Sends notifications to your mobile device via Home Assistant

## Installation
1. **Clone the repository:**
   ```cmd
   git clone https://github.com/Davidhanson90/ring-ai.git
   cd ring-ai
   ```
2. **Install dependencies:**
   ```cmd
   npm install
   ```
3. **Run the project:**
   ```cmd
   npm start
   ```

## Configuration
Create a `.env` file in the project root with the following variables:
```
HOME_ASSISTANT_URL=<your_home_assistant_url>
HOME_ASSISTANT_TOKEN=<your_long_lived_access_token>
SNAPSHOT_PATH=/local/ring_snapshots/front_door.jpg
OPENAI_API_KEY=<your_openai_api_key>
```

## Usage

```cmd
npx ts-node src/cli.ts
```

You will be prompted to select cameras and an interval for checking snapshots. The tool will:
- Trigger snapshots for selected cameras
- Download and save images to `src/output/`
- Compare new images to previous ones and remove duplicates
- Use OpenAI to describe the image
- Send notifications to your Home Assistant mobile app

## Output
Entity states and snapshots are stored in the `src/output/` directory:
- `enity-states.json`: Current states of all entities
- `snapshot_<camera>_<timestamp>.jpg`: Camera snapshots

## Contributing
Pull requests and issues are welcome! Please follow best practices for TypeScript and CLI development.

## License
MIT
