const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');
const chokidar = require('chokidar');
const WebSocket = require('ws');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use('/files', express.static('project_files'));

let db;
let wss;

// Initialize Database
async function initDB() {
  db = await open({
    filename: process.env.DATABASE_PATH || './advanced_projects.sqlite',
    driver: sqlite3.Database
  });
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      status TEXT DEFAULT 'Active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ai_context TEXT,
      folder_path TEXT,
      assigned_users TEXT,
      custom_tags TEXT,
      workflow TEXT
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_path TEXT,
      file_type TEXT,
      file_size INTEGER,
      folder TEXT DEFAULT 'documents',
      is_memory_file BOOLEAN DEFAULT FALSE,
      is_system_file BOOLEAN DEFAULT FALSE,
      is_locked BOOLEAN DEFAULT FALSE,
      locked_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checksum TEXT,
      tags TEXT,
      ai_tags TEXT,
      ai_analysis TEXT,
      FOREIGN KEY (project_id) REFERENCES projects (id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      user_id TEXT,
      type TEXT CHECK(type IN ('user', 'ai')),
      content TEXT,
      selected_files TEXT,
      workflow_step TEXT,
      ai_mode TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id)
    );

    CREATE TABLE IF NOT EXISTS event_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT,
      action TEXT,
      target TEXT,
      target_type TEXT,
      project_id TEXT,
      folder TEXT,
      details TEXT,
      changes TEXT,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
    CREATE INDEX IF NOT EXISTS idx_event_trail_project_id ON event_trail(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id ON chat_messages(project_id);
  `);
}

// File Management with Version Control
class FileManager {
  static async createProjectStructure(projectId) {
    const projectPath = path.join('project_files', projectId);
    const folders = [
      'memory', 'documents', 'evidence', 'communications', 
      'abilities', 'estimates', 'media', 'reports', 'workflows'
    ];
    
    await fs.mkdir(projectPath, { recursive: true });
    
    for (const folder of folders) {
      await fs.mkdir(path.join(projectPath, folder), { recursive: true });
    }
    
    // Create initial memory file
    const memoryPath = path.join(projectPath, 'memory', 'project_memory.md');
    const initialMemory = `# Project Memory

Created: ${new Date().toISOString()}

## Project Context

## Key Information

## Important Decisions

## Next Steps

## Custom Tags

## Workflows
`;
    await fs.writeFile(memoryPath, initialMemory);
    
    // Create abilities file
    const abilitiesPath = path.join(projectPath, 'abilities', 'project_abilities.json');
    const initialAbilities = JSON.stringify({
      abilities: [],
      created: new Date().toISOString(),
      version: "1.0"
    }, null, 2);
    await fs.writeFile(abilitiesPath, initialAbilities);
    
    return projectPath;
  }

  static async saveFile(projectId, file, folder = 'documents', userId = 'system') {
    const projectPath = path.join('project_files', projectId, folder);
    await fs.mkdir(projectPath, { recursive: true });
    
    const filename = `${Date.now()}_${file.originalname}`;
    const filePath = path.join(projectPath, filename);
    const checksum = crypto.createHash('md5').update(file.buffer).digest('hex');
    
    await fs.writeFile(filePath, file.buffer);
    
    const result = await db.run(`
      INSERT INTO project_files 
      (project_id, filename, original_name, file_path, file_type, file_size, folder, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, filename, file.originalname, filePath, 
      file.mimetype, file.size, folder, checksum
    ]);
    
    // Log event
    await EventLogger.log('file_uploaded', file.originalname, projectId, userId, {
      folder: folder,
      size: file.size,
      type: file.mimetype
    });
    
    return {
      id: result.lastID,
      filename,
      originalName: file.originalname,
      path: filePath,
      type: file.mimetype,
      size: file.size,
      folder
    };
  }

  static async lockFile(fileId, userId) {
    await db.run(
      'UPDATE project_files SET is_locked = TRUE, locked_by = ? WHERE id = ?',
      [userId, fileId]
    );
  }

  static async unlockFile(fileId, userId) {
    await db.run(
      'UPDATE project_files SET is_locked = FALSE, locked_by = NULL WHERE id = ?',
      [fileId]
    );
  }
}

// Event Logging System
class EventLogger {
  static async log(action, target, projectId, userId, details = {}) {
    await db.run(`
      INSERT INTO event_trail 
      (user_id, action, target, target_type, project_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      userId, action, target, 'file', projectId, JSON.stringify(details)
    ]);
    
    // Broadcast to WebSocket clients
    if (wss) {
      const event = {
        type: 'event_logged',
        action,
        target,
        projectId,
        userId,
        timestamp: new Date().toISOString(),
        details
      };
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(event));
        }
      });
    }
  }
}

// AI Context Manager with Enhanced Capabilities
class AIContextManager {
  constructor() {
    this.currentProject = null;
    this.globalMode = false;
    this.aiMode = 'can_edit'; // chat_only, create_only, can_edit
  }

  async lockToProject(projectId, userId) {
    this.currentProject = projectId;
    this.globalMode = false;
    
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    const files = await db.all('SELECT * FROM project_files WHERE project_id = ?', [projectId]);
    const memory = await this.getProjectMemory(projectId);
    
    await EventLogger.log('ai_locked_to_project', projectId, projectId, userId);
    
    return { project, files, memory };
  }

  async enterGlobalMode(userId) {
    this.globalMode = true;
    this.currentProject = null;
    
    const allProjects = await db.all('SELECT * FROM projects');
    
    await EventLogger.log('ai_entered_global_mode', 'global', null, userId);
    
    return { projects: allProjects };
  }

  async getProjectMemory(projectId) {
    // In a real implementation, this would read the memory files
    return {
      context: "Project-specific context and learned information",
      lastUpdated: new Date().toISOString()
    };
  }

  async generateAIResponse(message, selectedFileIds = [], userId = 'system') {
    if (!this.globalMode && !this.currentProject) {
      throw new Error('No project selected and not in global mode.');
    }

    // This would integrate with Claude API
    const contextInfo = this.globalMode ? 
      'Global Mode - All Projects' : 
      `Project: ${this.currentProject}`;
    
    const modeInfo = this.getAIModeConfig();
    
    return `AI Response (${contextInfo}, Mode: ${this.aiMode}): 

I understand you said "${message}". 

${modeInfo.description}

Selected files: ${selectedFileIds.length} files
How can I help you with this project?`;
  }

  getAIModeConfig() {
    switch (this.aiMode) {
      case 'chat_only':
        return {
          canEdit: false,
          canCreate: false,
          canDelete: false,
          description: 'I can only chat and analyze, no file modifications'
        };
      case 'create_only':
        return {
          canEdit: false,
          canCreate: true,
          canDelete: false,
          description: 'I can create new files but cannot edit existing ones'
        };
      case 'can_edit':
        return {
          canEdit: true,
          canCreate: true,
          canDelete: true,
          description: 'I have full file access and can make modifications'
        };
      default:
        return { canEdit: false, canCreate: false, canDelete: false };
    }
  }
}

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024 }
});

const aiContext = new AIContextManager();

// API Routes

// Projects
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await db.all(`
      SELECT p.*, 
             COUNT(DISTINCT f.id) as file_count,
             COALESCE(SUM(f.file_size), 0) as total_size
      FROM projects p
      LEFT JOIN project_files f ON p.id = f.project_id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, type, aiContext: projectAiContext } = req.body;
    const projectId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    await db.run(`
      INSERT INTO projects (id, name, type, ai_context, folder_path)
      VALUES (?, ?, ?, ?, ?)
    `, [projectId, name, type, projectAiContext, path.join('project_files', projectId)]);
    
    await FileManager.createProjectStructure(projectId);
    
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Project Selection (AI Lock)
app.post('/api/projects/:id/lock', async (req, res) => {
  try {
    const { user_id = 'system' } = req.body;
    const context = await aiContext.lockToProject(req.params.id, user_id);
    res.json({ 
      message: `AI locked to project ${req.params.id}`,
      context: {
        project: context.project.name,
        fileCount: context.files.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Files
app.get('/api/projects/:id/files', async (req, res) => {
  try {
    const files = await db.all(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY folder, filename',
      [req.params.id]
    );
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/upload', upload.array('files'), async (req, res) => {
  try {
    const { folder = 'documents', user_id = 'system' } = req.body;
    const projectId = req.params.id;
    const uploadedFiles = [];

    for (const file of req.files) {
      const savedFile = await FileManager.saveFile(projectId, file, folder, user_id);
      uploadedFiles.push(savedFile);
    }

    res.json({ files: uploadedFiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File locking
app.post('/api/files/:id/lock', async (req, res) => {
  try {
    const { user_id } = req.body;
    await FileManager.lockFile(req.params.id, user_id);
    res.json({ message: 'File locked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/files/:id/unlock', async (req, res) => {
  try {
    const { user_id } = req.body;
    await FileManager.unlockFile(req.params.id, user_id);
    res.json({ message: 'File unlocked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat
app.get('/api/projects/:id/chat', async (req, res) => {
  try {
    const messages = await db.all(
      'SELECT * FROM chat_messages WHERE project_id = ? ORDER BY timestamp ASC',
      [req.params.id]
    );
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/chat', async (req, res) => {
  try {
    const { message, selected_files = [], user_id = 'system' } = req.body;
    const projectId = req.params.id;
    
    // Ensure AI is locked to this project
    if (aiContext.currentProject !== projectId && !aiContext.globalMode) {
      await aiContext.lockToProject(projectId, user_id);
    }
    
    // Save user message
    await db.run(`
      INSERT INTO chat_messages (project_id, user_id, type, content, selected_files, ai_mode)
      VALUES (?, ?, 'user', ?, ?, ?)
    `, [projectId, user_id, message, JSON.stringify(selected_files), aiContext.aiMode]);
    
    // Generate AI response
    const aiResponse = await aiContext.generateAIResponse(message, selected_files, user_id);
    
    // Save AI response
    await db.run(`
      INSERT INTO chat_messages (project_id, user_id, type, content, selected_files, ai_mode)
      VALUES (?, ?, 'ai', ?, ?, ?)
    `, [projectId, 'ai', aiResponse, JSON.stringify(selected_files), aiContext.aiMode]);
    
    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI mode management
app.post('/api/ai/mode', async (req, res) => {
  try {
    const { mode, user_id } = req.body;
    aiContext.aiMode = mode;
    
    await EventLogger.log('ai_mode_changed', mode, aiContext.currentProject, user_id);
    res.json({ message: `AI mode set to ${mode}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/global-mode', async (req, res) => {
  try {
    const { enabled, user_id } = req.body;
    
    if (enabled) {
      const context = await aiContext.enterGlobalMode(user_id);
      res.json({ message: 'Entered global mode', context });
    } else {
      aiContext.globalMode = false;
      res.json({ message: 'Exited global mode' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event trail
app.get('/api/events', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const events = await db.all(`
      SELECT * FROM event_trail
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    features: {
      currentProject: aiContext.currentProject,
      globalMode: aiContext.globalMode,
      aiMode: aiContext.aiMode
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
async function startServer() {
  await initDB();
  
  const server = app.listen(PORT, () => {
    console.log(`Advanced AI Project Manager running on port ${PORT}`);
    console.log('Features: Project isolation, version control, AI context locking');
  });
  
  // WebSocket setup
  wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        // Handle client messages
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });
}

startServer().catch(console.error);

module.exports = app;