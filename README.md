# Advanced AI Project Manager

A Cursor AI-style Progressive Web App for intelligent project management with offline capabilities.

## 🚀 Features

- 🤖 **AI Assistant** - Context-aware project assistance powered by Claude
- 📱 **PWA** - Install as native app on any device with offline support
- 🔒 **Project Isolation** - AI locks to specific projects preventing data cross-contamination
- 📝 **File Management** - Read/write files with version control like Cursor AI
- 🌐 **Offline Support** - Work without internet, sync when reconnected
- 🔄 **Background Sync** - Automatic data synchronization
- 👥 **User Roles** - Role-based permissions (Admin, Production Manager, etc.)
- 📊 **Event Trail** - Complete audit logging with advanced filtering
- 🏷️ **Smart Tagging** - @mentions for quick data access across projects
- 📱 **Native Integration** - File handling, sharing, and push notifications

## 🛠️ Technology Stack

- **Frontend**: React 18 + PWA + Tailwind CSS
- **Backend**: Node.js + Express + SQLite
- **AI**: Claude API integration
- **Real-time**: WebSockets
- **Cloud**: Google Sheets integration
- **Storage**: Local + Cloud hybrid like Cursor AI

## ⚡ Quick Start

```bash
# Clone and setup
git clone https://github.com/SamHoward-Dev/projectcursorai.git
cd projectcursorai

# Run automated setup
chmod +x scripts/setup.sh
./scripts/setup.sh

# Configure environment
cp .env.example .env
# Edit .env with your Claude API key and Google Cloud credentials

# Start development servers
npm run dev:full
```

## 🔧 Manual Setup

If you prefer manual setup:

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Create necessary directories
mkdir -p project_files logs uploads

# Start backend
npm run dev

# Start frontend (in another terminal)
cd frontend && npm start
```

## 🌐 Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Health Check**: http://localhost:3001/api/health

## 📱 PWA Features

- **Offline Functionality**: Core features work without internet
- **Install Prompt**: Add to home screen on mobile/desktop
- **Background Sync**: Files upload when connection restored
- **Push Notifications**: Real-time project updates
- **File Handling**: Open PDFs/images directly in the app
- **Share Target**: Receive files from other apps

## 🔐 Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Required
CLAUDE_API_KEY=sk-ant-your_api_key_here

# Optional (for full features)
GOOGLE_PROJECT_ID=your-google-project-id
GOOGLE_SERVICE_ACCOUNT_PATH=./service-account-key.json
```

## 🚀 Deployment

### Development
```bash
npm run dev:full
```

### Production
```bash
npm run build
npm start
```

### Docker
```bash
docker build -t ai-project-manager .
docker run -p 3001:3001 ai-project-manager
```

## 📖 Usage

1. **Create Projects**: Click "+" to create new projects
2. **Lock AI Context**: Select a project to lock AI to that context
3. **Upload Files**: Drag & drop files into project folders
4. **Chat with AI**: AI understands your project context
5. **Offline Mode**: Continue working without internet
6. **Version Control**: Track all file changes automatically

## 🎯 Key Concepts

### Project Isolation
- AI can only access files from the currently selected project
- No data mixing between different projects/clients
- Complete context separation like Cursor AI

### AI Modes
- **Chat Only**: AI analyzes but cannot modify files
- **Create Only**: AI can create new files but not edit existing
- **Can Edit**: Full AI capabilities (admin only)

### File Organization
Each project automatically gets:
- `memory/` - AI memory and context files
- `documents/` - PDFs, contracts, reports
- `evidence/` - Photos, videos, proof files
- `communications/` - Emails, chat logs
- `abilities/` - AI procedures and SOPs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- Check the [Issues](https://github.com/SamHoward-Dev/projectcursorai/issues) page
- Read the [Setup Guide](docs/setup-guide.md)
- Review the [API Documentation](docs/api.md)

---

**Built with ❤️ for intelligent project management**