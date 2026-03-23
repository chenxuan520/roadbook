# RoadbookMaker

[中文](README.md) | English

<p align="center">
  <img src="static/favicon.png" alt="RoadbookMaker Logo" width="300" height="300">
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/chenxuan520/roadbook">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers" />
  </a>
</p>

RoadbookMaker is a powerful web-based map marking and route planning tool that allows users to easily edit itineraries on the map and export/share your trip plans.

## 🌐 Online Demo

- [https://map.chenxuanweb.top](https://map.chenxuanweb.top)
  *(Static version, does not support online saving)*
- [GitHub Pages Mirror](https://chenxuan520.github.io/roadbook/) (Auto-deployed by GitHub Actions)
  *(Connects to demo backend `roadmap.011203.xyz`, supports all features including AI Assistant and online login/saving. Default demo account: `admin`, password: `password`. Note: Demo environment data is only kept for 24 hours)*

## 🌟 Core Advantages

### 🚀 Zero Barrier to Entry
- **No API Key Required**: Completely free, no map service provider API keys needed
- **No VPN Required**: Directly accessible within Mainland China
- **No Registration/Login**: Ready to use immediately, no account system or login steps required (in offline mode)
- **Fully Offline Capable**: Data is stored locally, works perfectly even without an internet connection

### 📱 Ultimate Experience
- **Efficient Keyboard Workflow**: Rich shortcuts (e.g., A/C/D/F) and undo (Ctrl+Z) functions for a smooth operation experience.
- **One-Click Integration**: Integrates Ctrip ticket booking and various map navigations (Baidu, Gaode, Tencent, Google)
- **Open Source & Free**: Code is completely open source, free to use and modify

### 🏠 Self-Hosting Advantages
- **Serverless One-Click Deployment**: Supports one-click deployment of frontend and backend using Cloudflare Workers, free and maintenance-free
- **Docker Quick Deployment**: Supports Docker containerization, easy to operate, suitable for personal servers
- **Fully Self-Hosted**: You have complete control over your data, ensuring privacy and security
- **Powerful Online Mode**: The self-hosted online version has full functionality, supporting cloud sync and sharing
- **Zero Deployment Dependencies**: No complex environment configuration required, runs with a single command

## 🌟 Core Features

### Map Operations
- **Multi-Map Source Support**: OpenStreetMap, Gaode Map, Google Map, ESRI Satellite, etc.
- **Smart Search**: Integrates multiple search services like Photon, Nominatim, Overpass, Gaode Map, and TianDiTu
- **Coordinate Conversion**: Automatically handles conversion from Chinese map coordinate systems (GCJ-02, BD-09) to standard GPS

### Marker Management
- **Diverse Markers**: Supports numbers, emojis, custom icons, and colors
- **Time Planning**: Set multiple time points for each marker, supports grouping by date
- **Detailed Information**: Add names, notes, coordinate info, etc.
- **Drag & Drop Editing**: Support adjusting marker positions by dragging with the mouse

### Route Connections
- **Multiple Transport Modes**: Car🚗, Train🚄, Subway🚇, Flight✈️, Walk🚶, etc.
- **Smart Connection**: Automatically calculates distance, supports setting duration
- **Navigation Integration**: One-click generation of Baidu, Gaode, Tencent, and Google navigation links
- **Ticket Booking**: Integrates Ctrip train and flight ticket queries
- **Hotel Booking**: Integrates Google Hotels for easy accommodation planning
- **Content Exploration**: Integrates Xiaohongshu (RED) to discover more interesting content about destinations

### Expense Management
- **Expense Records**: Record travel expenses by date, each entry includes amount and remarks
- **Auto Statistics**: Real-time calculation of daily total expenses and total budget for the entire trip
- **Quick Operations**: Double-click to edit expense records, press Enter to quick-save

### Data Management
- **Local Storage**: Automatically saves to browser local storage, data won't be lost upon refresh
- **Import/Export**: Supports JSON format import/export for easy backup and sharing
- **HTML Export**: Generates a standalone HTML file containing complete map information
- **Image Export (Long PNG)**: Generates a shareable long itinerary image (including daily maps and timelines), perfect for social media
- **ICS Export**: Generates iCalendar (.ics) files, can be imported into Apple Calendar, Google Calendar, Outlook, etc., for itinerary reminders
- **Share Function**: Supports generating share links, others can import your roadbook

### 🦄 AI Assistant (Special Feature)
- **Natural Language Interaction**: Call up the AI Assistant via the floating button in the bottom right, interact with the map using natural language.
- **Smart Itinerary Planning**:
  - **One-Click Generation**: Enter "Help me plan a 3-day trip to Beijing", AI will auto-search places, plan routes, and schedule time.
  - **Multi-Day Scheduling**: AI understands multi-day trips, auto-assigns itineraries to different dates, and adds daily summaries.
- **Precise Map Operations**:
  - **Add/Delete/Modify**: "Add the Forbidden City next to Tiananmen", "Change the specific time of the second spot to tomorrow 2 PM".
  - **Route Connections**: "Connect these points by driving", "How to go from the airport to the hotel".
- **Information Query & Enhancement**:
  - **Place Search**: When encountering ambiguous place names, AI auto-searches and confirms coordinates.
  - **Date Notes**: Automatically adds summaries or tips for each day's itinerary.
- **Quick Commands**:
  - `/generate <prompt>`: Quickly generate a complete itinerary.
  - `/xiaohongshu [prompt]`: Export current itinerary as a Xiaohongshu post (optional style preference).
  - `/clear`: Clear conversation history.
  - `/help`: View help.
- **Configuration Requirements**: This feature requires self-hosting and providing an API Key for an AI model (like OpenAI, Cloudflare Workers AI, etc.) in the backend configuration.

### PWA Support
- **App Installation**: Supports installing the webpage as a native desktop or mobile app
- **Offline Access**: Caches core resources via Service Worker, opens instantly even in poor networks or offline
- **Immersive Experience**: Runs in full screen, removes browser address bar distractions, provides a native app-like experience

### User Experience
- **Shortcut Support**: A(Add), C(Connect), D/Backspace/Del(Delete), F(Fit View), H(Help), etc.; supports Ctrl/Cmd+S for "Cloud Save" in online mode
- **Undo Function**: Ctrl+Z supports undoing operations
- **Responsive Design**: Adapts to different screen sizes, supports mobile viewing
- **Real-Time Preview**: All editing operations are displayed on the map in real-time

## 🚀 Quick Start

### 🎬 Video Introduction

- [Bilibili Video](https://player.bilibili.com/player.html?isOutside=true&aid=115690749040661&bvid=BV1EDmHByEYh&cid=34624048670&p=1)

### Online Usage
1. Visit the project website
2. Click "Add Marker" or press `A` to start adding places
3. Click "Connect Markers" or press `C` to connect two places
4. Edit detailed info, set time and transport mode
5. Export your roadbook to share

### Local Deployment

#### Environment Requirements
- Go 1.18+
- Nginx (Recommended)
- Modern Browser

#### Deployment Steps

1. **Clone the project**
```bash
git clone https://github.com/chenxuan520/roadbook.git
cd roadbook
```

2. **Generate and configure backend service**
   The backend service now requires a `config.json` file to run. To simplify configuration and enhance security, we provide an interactive script.

   a. **Generate config file**
      Run the config generation script in the project root:
      ```bash
      ./scripts/generate_config.sh
      ```
      The script will prompt you for port, admin account password, allowed CORS origins, etc. It will automatically generate a `backend/configs/config.json` file.

   b. **Build backend service**
      Run the build script in the `backend` directory to compile the backend service:
      ```bash
      ./scripts/build.sh
      ```
      This will generate an executable named `roadbook-api` in the `backend/` directory.

   c. **Start backend service**
      Run the compiled executable in the `backend` directory:
      ```bash
      ./roadbook-api
      ```

   d. **(Optional) Configure Gaode Map Search**
      This project supports Gaode Map search. To enable it, add a `search` block in the `backend/configs/config.json` file and fill in your Gaode API Key.

      **Config Example:**
      ```json
      {
        "port": 5436,
        "...": "...",
        "search": {
          "providers": {
            "gaode": {
              "key": "your_gaode_api_key_here",
              "login_required": false
            }
          }
        }
      }
      ```

   e. **(Optional) Configure AI Assistant**
      This project supports integrating an LLM that follows the OpenAI API specification as the AI Assistant. To enable it, add an `ai` block in the `backend/configs/config.json` file.

      **Config Example:**
      ```json
      {
        "port": 5436,
        "...": "...",
        "ai": {
          "enabled": true,
          "base_url": "https://api.openai.com/v1",
          "key": "sk-YOUR_API_KEY",
          "model": "gpt-4o-mini"
        }
      }
      ```

3. **Configure Nginx** (Optional but recommended)
```bash
sudo cp ./nginx.prod.conf /etc/nginx/sites-available/roadbook
sudo ln -s /etc/nginx/sites-available/roadbook /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

4. **Access the Application**
Open your browser and visit `http://localhost` to use it

#### Docker Deployment (Pull Image Directly)
You can also directly pull the pre-built image from Docker Hub or Aliyun Container Registry and run it.

1.  **Pull Image**

    **From Docker Hub:**
    ```bash
    docker pull chenxuan520/roadbook:latest
    ```

    **From Aliyun (Recommended for Mainland China users):**
    ```bash
    docker pull registry.cn-hangzhou.aliyuncs.com/chenxuan/roadbook:latest
    ```

2.  **Run Container**
    ```bash
    docker run -d \
      --name roadbook \
      -p 80:80 \
      -v roadbook_data:/app/data \
      chenxuan520/roadbook:latest
    ```
    - `-p 80:80`: Maps host port 80 to container port 80.
    - `-v roadbook_data:/app/data`: Creates and mounts a Docker volume named `roadbook_data` to **persist** roadbook data.
    - Optionally, use `-v $(pwd)/my-config.json:/app/configs/config.json:ro` to mount a custom config file.

3.  **Access the Application**
    Open your browser and visit `http://localhost` or `http://your_server_ip`. The default account is `admin` and password is `password`.

### Cloudflare Worker Deployment (Serverless)
If you don't want to maintain a server, you can deploy a full-featured backend using Cloudflare Workers.
It supports all core features (plan management, user authentication, search proxy, etc.), and data is stored in Cloudflare KV.

> **✨ One-Click Deployment**
> 
> Click the button below to deploy the complete Roadbook service (frontend proxy + backend API) to your Cloudflare Workers.
>
> [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chenxuan520/roadbook)

For detailed deployment guides, please refer to [cloudflare/README.md](cloudflare/README.md).

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- [Leaflet](https://leafletjs.com/) - Excellent open-source map library
- [OpenStreetMap](https://www.openstreetmap.org/) - Free editable map of the whole world
- Map service providers like Gaode, Google, etc.
- All contributors and users

---

**⭐ If this project is helpful to you, please give it a Star!**
