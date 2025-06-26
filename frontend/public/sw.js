const CACHE_NAME = 'ai-project-manager-v1.0.0';
const STATIC_CACHE = 'static-v1.0.0';
const API_CACHE = 'api-v1.0.0';

const STATIC_FILES = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json',
  '/favicon.ico'
];

// Install Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_FILES);
    })
  );
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && 
                cacheName !== API_CACHE) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      self.clients.claim()
    ])
  );
});

// Fetch Strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle file uploads
  if (request.method === 'POST' && url.pathname.includes('/upload')) {
    event.respondWith(handleFileUpload(request));
    return;
  }

  // Handle static files
  if (request.destination === 'document' || 
      request.destination === 'script' || 
      request.destination === 'style' ||
      request.destination === 'image') {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Default strategy
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request);
    })
  );
});

// API Request Handler - Cache with Network Update
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE);
  
  try {
    // Try network first
    const response = await fetch(request);
    
    if (response.ok) {
      // Update cache with fresh data
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('Network failed, checking cache for:', request.url);
    
    // Fallback to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // Add offline indicator header
      const headers = new Headers(cachedResponse.headers);
      headers.append('X-Served-From', 'cache');
      
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers
      });
    }
    
    // Return offline response for specific endpoints
    if (request.url.includes('/api/projects')) {
      return new Response(JSON.stringify({
        projects: [],
        offline: true,
        message: 'Projects will sync when online'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    throw error;
  }
}

// File Upload Handler - Queue for When Online
async function handleFileUpload(request) {
  try {
    return await fetch(request);
  } catch (error) {
    // Store upload for when back online
    const uploadQueue = await getUploadQueue();
    const requestData = await request.formData();
    
    uploadQueue.push({
      url: request.url,
      method: request.method,
      data: requestData,
      timestamp: Date.now(),
      id: generateId()
    });
    
    await setUploadQueue(uploadQueue);
    
    return new Response(JSON.stringify({
      success: false,
      offline: true,
      message: 'Upload queued for when online',
      queueId: uploadQueue[uploadQueue.length - 1].id
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Static Request Handler - Cache First
async function handleStaticRequest(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return placeholder for images
    if (request.destination === 'image') {
      return new Response('', { status: 200 });
    }
    throw error;
  }
}

// Navigation Handler - App Shell Pattern
async function handleNavigationRequest(request) {
  try {
    return await fetch(request);
  } catch (error) {
    // Return app shell from cache
    const cache = await caches.open(STATIC_CACHE);
    return await cache.match('/') || await cache.match('/offline.html');
  }
}

// Background Sync for File Uploads
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'upload-queue') {
    event.waitUntil(processUploadQueue());
  }
});

// Process Queued Uploads
async function processUploadQueue() {
  const uploadQueue = await getUploadQueue();
  const successfulUploads = [];
  
  for (const upload of uploadQueue) {
    try {
      const response = await fetch(upload.url, {
        method: upload.method,
        body: upload.data
      });
      
      if (response.ok) {
        successfulUploads.push(upload.id);
        
        // Notify clients of successful upload
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'UPLOAD_SUCCESS',
              uploadId: upload.id,
              response: response
            });
          });
        });
      }
    } catch (error) {
      console.log('Upload failed, keeping in queue:', upload.id);
    }
  }
  
  // Remove successful uploads from queue
  const remainingQueue = uploadQueue.filter(
    upload => !successfulUploads.includes(upload.id)
  );
  await setUploadQueue(remainingQueue);
}

// Push Notifications
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New activity in your projects',
    icon: '/logo192.png',
    badge: '/logo192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View Project',
        icon: '/logo192.png'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('AI Project Manager', options)
  );
});

// Handle Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/projects')
    );
  }
});

// Utility Functions
async function getUploadQueue() {
  const queue = await self.caches.open('upload-queue');
  const response = await queue.match('queue');
  return response ? await response.json() : [];
}

async function setUploadQueue(queue) {
  const cache = await self.caches.open('upload-queue');
  await cache.put('queue', new Response(JSON.stringify(queue)));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}