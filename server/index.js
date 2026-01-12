// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');
const ogs = require('open-graph-scraper');
const sharp = require('sharp'); // 图像压缩
const sanitizeHtml = require('sanitize-html'); // XSS 清洗
const rateLimit = require('express-rate-limit'); // 速率限制
const { PrismaClient } = require('@prisma/client');
const { verifyPassword, generateToken, verifyToken } = require('./utils');

const app = express();
app.set('trust proxy', 1)
const server = http.createServer(app);
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-secret-key-2024';

// --- Socket.io 初始化 (提前初始化以便 API 路由调用) ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- 工业级安全配置 ---
const corsOptions = {
  origin: true, // 允许任何来源 (解决 chatbox1 访问 chatbox 的问题)
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true // 允许携带 Token
};

app.use(cors(corsOptions));          // 1. 应用规则
app.options('*', cors(corsOptions)); // 2. 【关键】强制处理 OPTIONS 预检请求

app.use(express.json({ limit: '10mb' })); // 限制 Payload 大小

// 统一的 HTML 清洗配置
const sanitizeConfig = { 
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img', 'span', 'div', 'br', 'pre', 'code', 'h1', 'h2', 'h3', 'u' ]),
  allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'span': ['style'],
      'div': ['style'],
      'p': ['style'],
      'table': ['style', 'class'],
      'td': ['style', 'class'],
      'th': ['style', 'class'],
      '*': ['style'] // 允许所有标签带 style 以支持颜色
  },
  allowedStyles: {
      '*': {
          'color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/, /^[a-z]+$/],
          'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/, /^[a-z]+$/],
          'text-align': [/^left$/, /^right$/, /^center$/],
          'font-size': [/^\d+(?:px|em|%)$/]
      }
  }
};

// 速率限制: 15分钟内最多 5000 次请求 (放宽限制以排除 Bookmark 频繁触发导致的 429)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --- 文件上传与压缩 (需求 2.2) ---
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadDir));

// --- 鉴权中间件 ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) { return res.sendStatus(403); }
};

// --- HTTP API ---

// 1. 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = generateToken({ id: user.id, username: user.username });
    const { password: _, ...userWithoutPwd } = user;
    res.json({ token, user: userWithoutPwd });
  } catch (error) { res.status(500).json({ error: 'Login failed' }); }
});

// 1.5 获取用户列表 (用于 @提及)
app.get('/api/users', authenticateToken, async (req, res) => {
    const search = req.query.search || '';
    try {
        const users = await prisma.user.findMany({
            where: {
                username: { contains: search }
            },
            select: { id: true, username: true, avatar: true },
            take: 10
        });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// 1.6 获取提及列表
app.get('/api/mentions', authenticateToken, async (req, res) => {
    const { unreadOnly } = req.query;
    const where = { userId: req.user.id };
    if (unreadOnly === 'true') where.isRead = false;
    
    try {
        const mentions = await prisma.mention.findMany({
            where,
            include: {
                message: {
                    include: { user: { select: { id: true, username: true, avatar: true } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(mentions);
    } catch(e) { res.status(500).json({ error: 'Failed to fetch mentions' }); }
});

// 2. 智能上传接口 (含压缩逻辑) [1]
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let fileUrl = `/uploads/${req.file.filename}`;
  let isImage = req.file.mimetype.startsWith('image/');
  
  // 如果是图片，生成 WebP 压缩版
  if (isImage) {
    const optimizedName = `opt-${req.file.filename.split('.')[0]}.webp`;
    const optimizedPath = path.join(uploadDir, optimizedName);
    
    try {
      await sharp(req.file.path)
        .resize({ width: 1280, withoutEnlargement: true }) // 限制最大宽度
        .webp({ quality: 80 })
        .toFile(optimizedPath);
      
      // 返回优化后的 URL 作为默认显示
      fileUrl = `/uploads/${optimizedName}`;
    } catch (err) {
      console.error("Image optimization failed, using original:", err);
    }
  }
  res.json({
    url: fileUrl,
    originalUrl: `/uploads/${req.file.filename}`, // 保留原图路径
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size
  });
});

// 2.5 收藏功能 - 切换收藏状态
app.post('/api/bookmarks', authenticateToken, async (req, res) => {
    console.log(`Bookmark toggle requested by user ${req.user.id} for message ${req.body.messageId}`);
    const { messageId } = req.body;
    const userId = req.user.id;
    try {
        const existing = await prisma.bookmark.findUnique({
            where: { userId_messageId: { userId, messageId } }
        });

        let bookmarked = false;
        if (existing) {
            await prisma.bookmark.delete({ where: { id: existing.id } });
            bookmarked = false;
        } else {
            await prisma.bookmark.create({ data: { userId, messageId } });
            bookmarked = true;
        }

        // 获取完整消息以便前端更新列表
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
                user: { select: { id: true, username: true, avatar: true } },
                attachments: true,
                reactions: { include: { user: { select: { id: true, username: true } } } }, // Added id to reaction user select
                parent: { include: { user: { select: { id: true, username: true, avatar: true } } } }, // Added id/avatar to parent user select
                editHistory: true,
                readBy: { select: { userId: true, user: { select: { id: true, username: true } } } }, // Added id to readBy user select
                mentions: { include: { user: { select: { id: true, username: true } } } }, // Added id to mention user select
                bookmarks: { where: { userId } }
            }
        });

        // 广播私有事件 - 仅给当前用户
        console.log(`Emitting bookmark_updated to user_${userId}`);
        io.to(`user_${userId}`).emit('bookmark_updated', { message, bookmarked });
        
        res.json({ bookmarked });
    } catch (e) {
        console.error("Bookmark toggle failed:", e.message);
        res.status(500).json({ error: 'Failed to toggle bookmark' });
    }
});

// 2.6 收藏功能 - 获取收藏列表
app.get('/api/bookmarks', authenticateToken, async (req, res) => {
    try {
        const bookmarks = await prisma.bookmark.findMany({
            where: { 
                userId: req.user.id,
                message: { isDeleted: false } // 只返回未删除的消息
            },
            include: {
                message: {
                    include: {
                        user: { select: { id: true, username: true, avatar: true } },
                        attachments: true,
                        reactions: { include: { user: { select: { username: true } } } },
                        parent: { include: { user: { select: { username: true } } } },
                        editHistory: true,
                        readBy: true,
                        mentions: true,
                        bookmarks: { where: { userId: req.user.id } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(bookmarks.map(b => b.message));
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch bookmarks' });
    }
});

// 2.7 搜索功能
app.get('/api/messages/search', authenticateToken, async (req, res) => {
    const { q, sender, date } = req.query;
    const where = { isDeleted: false };

    if (q) {
        where.content = { contains: q };
    }
    if (sender) {
        where.user = { username: { contains: sender } };
    }
    if (date) {
        const start = new Date(date);
        const end = new Date(date);
        end.setDate(end.getDate() + 1);
        where.createdAt = { gte: start, lt: end };
    }

    try {
        const messages = await prisma.message.findMany({
            where,
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, username: true, avatar: true } },
                attachments: true,
                reactions: { include: { user: { select: { username: true } } } },
                parent: { include: { user: { select: { username: true } } } },
                editHistory: true,
                readBy: true,
                mentions: true,
                bookmarks: { where: { userId: req.user.id } } // 包含收藏状态
            }
        });
        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: 'Search failed' });
    }
});

// 2.8 获取消息上下文 (定位跳转用)
app.get('/api/messages/:id/context', authenticateToken, async (req, res) => {
    const messageId = parseInt(req.params.id);
    try {
        const targetMsg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!targetMsg) return res.status(404).json({ error: 'Message not found' });

        const prevMessages = await prisma.message.findMany({
            take: 10,
            where: { 
                id: { lt: messageId },
                isDeleted: false 
            },
            orderBy: { id: 'desc' },
            include: {
                user: { select: { id: true, username: true, avatar: true } },
                attachments: true,
                reactions: { include: { user: { select: { username: true } } } },
                parent: { include: { user: { select: { username: true } } } },
                editHistory: true,
                readBy: true,
                mentions: true,
                bookmarks: { where: { userId: req.user.id } }
            }
        });

        const nextMessages = await prisma.message.findMany({
            take: 10,
            where: { 
                id: { gte: messageId }, // 包含自身
                isDeleted: false 
            },
            orderBy: { id: 'asc' },
            include: {
                user: { select: { id: true, username: true, avatar: true } },
                attachments: true,
                reactions: { include: { user: { select: { username: true } } } },
                parent: { include: { user: { select: { username: true } } } },
                editHistory: true,
                readBy: true,
                mentions: true,
                bookmarks: { where: { userId: req.user.id } }
            }
        });

        const combined = [...prevMessages.reverse(), ...nextMessages];
        res.json(combined);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch context' });
    }
});

// 2.9 文件中心 - 获取所有附件
app.get('/api/files', authenticateToken, async (req, res) => {
    const { type } = req.query; // 'media' or 'file'
    const where = {
        message: { isDeleted: false } // Filter out deleted messages
    };
    
    if (type === 'media') {
        where.mimeType = { startsWith: 'image/' };
    } else if (type === 'file') {
        where.mimeType = { not: { startsWith: 'image/' } };
    }

    try {
        const files = await prisma.attachment.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                message: {
                    include: { user: { select: { username: true } } }
                }
            }
        });
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

// 3. 获取消息 (含游标分页与过滤)
app.get('/api/messages', authenticateToken, async (req, res) => { // 鉴权以获取 req.user.id
  const cursor = req.query.cursor ? parseInt(req.query.cursor) : undefined;
  try {
    const messages = await prisma.message.findMany({
      take: 2000,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      where: {
        isDeleted: false, 
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        attachments: true,
        reactions: { include: { user: { select: { username: true } } } },
        parent: { include: { user: { select: { username: true } } } },
        editHistory: true,
        readBy: { select: { userId: true, user: { select: { username: true } } } },
        mentions: { include: { user: { select: { username: true } } } },
        bookmarks: { where: { userId: req.user.id } } // 检查当前用户是否收藏
      }
    });
    res.json(messages.reverse());
  } catch (error) { res.status(500).json({ error: 'Failed to fetch messages' }); }
});

// 4. 设备管理 - 获取设备列表
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      where: { userId: req.user.id },
      orderBy: { lastActiveAt: 'desc' }
    });
    res.json(devices);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch devices' }); }
});

// 5. 设备管理 - 强制下线
app.post('/api/devices/revoke', authenticateToken, async (req, res) => {
  const { deviceId } = req.body;
  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    
    // 权限检查:只能踢自己的设备
    if (!device || device.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // 1. 数据库物理删除
    await prisma.device.delete({ where: { id: deviceId } });

    // 2. Socket 强制断开 (核心逻辑)
    const targetSocket = io.sockets.sockets.get(device.socketId);
    if (targetSocket) {
      targetSocket.emit('force_logout', { reason: 'Device revoked by user' });
      targetSocket.disconnect(true);
    }

    res.json({ success: true });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Revoke failed' }); 
  }
});


// [新增] 6. 获取 Thread 详情 (线索视图) - 增强版 (递归查找完整链条)
app.get('/api/messages/:id/thread', authenticateToken, async (req, res) => {
  const startId = parseInt(req.params.id);
  
  // 统一的 Include 对象 (确保与 MessageBubble 兼容)
  const messageInclude = {
      user: { select: { id: true, username: true, avatar: true } },
      attachments: true,
      reactions: { include: { user: { select: { username: true } } } },
      parent: { include: { user: { select: { username: true } } } }, // 引用回复也需要
      editHistory: true,
      readBy: { select: { userId: true, user: { select: { username: true } } } }, // 修复：必须包含 user 信息
      mentions: true,
      bookmarks: { where: { userId: req.user.id } }
  };

  try {
    // 1. 向上追溯找到真正的 Root (Ultimate Root)
    let rootMessage = await prisma.message.findUnique({
      where: { id: startId },
      include: messageInclude
    });

    if (!rootMessage) return res.status(404).json({ error: 'Message not found' });

    // 循环向上查找直到 parentId 为 null
    while (rootMessage.parentId) {
        const parent = await prisma.message.findUnique({
            where: { id: rootMessage.parentId },
            include: messageInclude
        });
        if (!parent) break; // 应对 parent 被物理删除的边缘情况
        rootMessage = parent;
    }

    // 2. 向下递归查找所有后代 (BFS)
    let allReplies = [];
    let queue = [rootMessage.id];

    // 防止死循环的深度限制 (虽然 ID 不会重复，但为了保险)
    let depth = 0;
    const MAX_DEPTH = 50; 

    while (queue.length > 0 && depth < MAX_DEPTH) {
        const batch = await prisma.message.findMany({
            where: { 
                parentId: { in: queue },
                // 移除 isDeleted: false 过滤，确保即使父消息被删除，子消息也能被找到
                // 前端需要处理 isDeleted 为 true 的显示逻辑
            },
            orderBy: { createdAt: 'asc' },
            include: messageInclude
        });

        if (batch.length === 0) break;

        allReplies.push(...batch);
        queue = batch.map(m => m.id); // 下一轮查找 these 消息的子消息
        depth++;
    }

    // 按时间排序确保显示顺序正确
    allReplies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({ root: rootMessage, replies: allReplies });
  } catch (e) {
    console.error("Thread fetch error:", e);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// --- 定时任务 (Cron) ---
// 每分钟扫描并物理删除过期的"阅后即焚"消息
cron.schedule('* * * * *', async () => {
  try {
    const result = await prisma.message.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });
    if (result.count > 0) {
      console.log(`🧹 Auto-deleted ${result.count} expired messages`);
      io.to('general').emit('messages_expired'); 
    }
  } catch (e) { console.error("Cron Error:", e); }
});

// --- Socket.io 核心逻辑 ---

// 全局缓冲池：用于聚合已读回执 { messageId: Set(userIds) }
const readReceiptBuffer = new Map();

// 定时冲刷缓冲区 (Throttle: 2秒一次) [1]
setInterval(() => {
  if (readReceiptBuffer.size === 0) return;
  readReceiptBuffer.forEach((userIds, messageId) => {
    // 广播聚合后的已读事件
    io.to('general').emit('message_read_update_batch', {
      messageId,
      userIds: Array.from(userIds)
    });
  });
  readReceiptBuffer.clear();
}, 2000);

// Socket 中间件
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const decoded = verifyToken(token);
    socket.user = decoded;
    next();
  } catch (err) { next(new Error("Invalid token")); }
});

io.on('connection', async (socket) => {
  const currentUser = socket.user;
  console.log(`User connected: ${currentUser.username}, Socket: ${socket.id}`);
  socket.join('general');
  socket.join(`user_${currentUser.id}`); // 加入用户专属房间，用于私有通知
  
  // 记录设备
  try {
      await prisma.device.create({
        data: {
          userId: currentUser.id,
          socketId: socket.id,
          deviceInfo: socket.handshake.headers['user-agent'] || 'Unknown'
        }
      });
  } catch (e) {
      console.error("Failed to record device:", e.message);
  }

  io.to('general').emit('user_status', { userId: currentUser.id, status: 'online' });

  // A. 发送消息 (异步 OGS 优化版) [1]
  socket.on('send_message', async (data) => {
    try {
      // 1. 输入清洗 (允许富文本标签)
      const cleanContent = sanitizeHtml(data.content, sanitizeConfig);

      // 2. 提及处理
      const mentionData = (data.mentionUserIds || []).map(uid => ({ userId: uid }));

      // 3. 先存入数据库 (linkMetadata 留空)
      const newMessage = await prisma.message.create({
        data: {
          content: cleanContent,
          type: data.type || 'text',
          userId: currentUser.id,
          parentId: data.replyToId || null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          linkMetadata: null, // 暂无预览
          attachments: { create: data.attachments || [] },
          mentions: { create: mentionData }
        },
        include: {
            user: { select: { id: true, username: true, avatar: true } },
            attachments: true,
            parent: { include: { user: { select: { username: true } } } },
            mentions: { include: { user: { select: { username: true } } } }
        }
      });

      // 4. 即刻广播 (保证极致的即时响应速度)
      io.to('general').emit('new_message', newMessage);

      // 5. 异步处理 URL 抓取 (后台任务)
      const urlMatch = cleanContent.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        // 不 await，让其在后台运行
        ogs({ url: urlMatch[0] }).then(async ({ result }) => {
          if (!result.success) return;
          const metadata = JSON.stringify({
            title: result.ogTitle,
            image: result.ogImage?.[0]?.url,
            description: result.ogDescription
          });
          // 更新数据库
          const updatedMsg = await prisma.message.update({
            where: { id: newMessage.id },
            data: { linkMetadata: metadata },
            include: { // 重新 include 必要字段以保持前端数据结构一致
              user: { select: { id: true, username: true, avatar: true } },
              attachments: true,
              parent: { include: { user: { select: { username: true } } } },
              mentions: true
            } 
          });
          // 广播更新事件，前端收到后静默刷新卡片
          io.to('general').emit('message_updated', updatedMsg);
        }).catch(err => console.warn(`OGS failed for msg ${newMessage.id}:`, err.message));
      }
    } catch (e) {
      console.error("Send error:", e);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // B. 撤回消息
  socket.on('delete_message', async ({ messageId }) => {
     await handleDeleteMessage(socket, messageId);
  });

  // B2. 恢复消息 (Undo Delete)
  socket.on('restore_message', async ({ messageId }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg || msg.userId !== currentUser.id) return;

        // 恢复消息及置顶状态
        const restored = await prisma.message.update({
            where: { id: messageId },
            data: { 
                isDeleted: false,
                isPinned: msg.wasPinned, // 恢复置顶状态
                wasPinned: false
            }
        });
        
        // 1. 广播基础恢复事件
        const updatedMsg = await prisma.message.findUnique({
             where: { id: messageId },
             include: {
                user: { select: { id: true, username: true, avatar: true } },
                attachments: true,
                reactions: { include: { user: { select: { username: true } } } },
                parent: { include: { user: { select: { username: true } } } },
                editHistory: true,
                readBy: { select: { userId: true, user: { select: { username: true } } } },
                mentions: { include: { user: { select: { username: true } } } },
                // bookmarks: 不能 include, 因为是动态的
             }
        });
        io.to('general').emit('message_restored', updatedMsg);

        // 2. 如果恢复了置顶，广播置顶事件
        if (restored.isPinned) {
            io.to('general').emit('message_pinned', { messageId, isPinned: true });
        }

        // 3. 检查是否有用户收藏了此消息，并发送更新以恢复收藏列表
        const bookmarks = await prisma.bookmark.findMany({ where: { messageId } });
        for (const bm of bookmarks) {
             const msgForUser = { ...updatedMsg, bookmarks: [bm] }; // 手动构造 bookmarks array
             io.to(`user_${bm.userId}`).emit('bookmark_updated', { message: msgForUser, bookmarked: true });
        }

      } catch(e) { console.error(e); }
  });

  // C. 编辑消息 (集成 sanitizeHtml)
  socket.on('edit_message', async ({ messageId, newContent }) => {
    try {
      const msg = await prisma.message.findUnique({ where: { id: messageId } });
      if (!msg || msg.userId !== currentUser.id) throw new Error("Unauthorized");
      
      // 5分钟编辑限制
      if (Date.now() - new Date(msg.createdAt).getTime() > 5 * 60 * 1000) {
          throw new Error("Edit time limit exceeded (5 mins)");
      }

      // XSS 清洗
      const cleanContent = sanitizeHtml(newContent, sanitizeConfig);

      const updatedMessage = await prisma.$transaction(async (tx) => {
        await tx.messageHistory.create({
            data: { messageId: msg.id, oldContent: msg.content || "" }
        });
        // Reset mention read status on edit
        await tx.mention.updateMany({
            where: { messageId: msg.id },
            data: { isRead: false, readAt: null }
        });

        return await tx.message.update({
          where: { id: messageId },
          data: { content: cleanContent },
          include: { 
              editHistory: true, 
              user: { select: { id: true, username: true, avatar: true } }, // 保持一致的 user select
              parent: { include: { user: { select: { username: true } } } }, // 【修复】保留回复引用
              attachments: true,
              reactions: { include: { user: { select: { username: true } } } },
              mentions: { include: { user: { select: { username: true } } } },
              readBy: { select: { userId: true, user: { select: { username: true } } } }
          }
        });
      });
      io.to('general').emit('message_updated', updatedMessage);
    } catch (e) { socket.emit('error', { message: e.message }); }
  });

  // D. 消息置顶
  socket.on('pin_message', async ({ messageId, isPinned }) => {
    try {
      // 互斥逻辑：如果设置置顶，先取消其他
      if (isPinned) {
          await prisma.message.updateMany({
              where: { isPinned: true },
              data: { isPinned: false }
          });
      }

      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { isPinned } 
      });
      io.to('general').emit('message_pinned', { messageId, isPinned });
    } catch (e) {
      console.error(e);
      socket.emit('error', { message: 'Failed to pin message' });
    }
  });

  // E. 智能表情切换 (Toggle Reaction)
  socket.on('toggle_reaction', async (data) => {
    try {
      const { messageId, emoji } = data;
      const userId = currentUser.id;

      // 1. 检查是否存在
      const existingReaction = await prisma.reaction.findUnique({
        where: {
          userId_messageId_emoji: { userId, messageId, emoji }
        },
        include: { user: { select: { username: true } } }
      });

      if (existingReaction) {
        // [情况 A]: 已存在 -> 删除 (取消点赞)
        await prisma.reaction.delete({ where: { id: existingReaction.id } });
        
        // 广播移除事件
        io.to('general').emit('message_reaction_removed', {
          messageId,
          emoji,
          userId
        });
      } else {
    // [情况 B]: 不存在 -> 新增
    const newReaction = await prisma.reaction.create({
      data: { emoji, userId: Number(userId), messageId: Number(messageId) },
      include: { user: { select: { id: true, username: true } } }
    });

        // 广播新增事件
        io.to('general').emit('message_reaction_added', {
          messageId,
          reaction: {
            id: newReaction.id,
            emoji: newReaction.emoji,
            userId: newReaction.userId,
            user: { username: currentUser.username }
          }
        });
      }
    } catch (e) {
      console.error("Reaction toggle error:", e);
    }
  });

  // G. Typing 状态
  socket.on('typing_start', () => { 
      if (!currentUser) return;
      socket.broadcast.to('general').emit('user_typing', { userId: currentUser.id, username: currentUser.username }); 
  });

  // F. 已读回执 (聚合优化版) [1]
  socket.on('mark_read', async ({ messageId }) => {
    try {
      // 1. 写入数据库 (保持精准记录)
      await prisma.messageRead.upsert({
        where: { userId_messageId: { userId: currentUser.id, messageId } },
        update: {}, create: { userId: currentUser.id, messageId }
      });
      // 2. 写入内存缓冲区，等待聚合广播
      if (!readReceiptBuffer.has(messageId)) {
        readReceiptBuffer.set(messageId, new Set());
      }
      readReceiptBuffer.get(messageId).add(currentUser.id);
      
    } catch(e) {}
  });

  // H. 提及签到 (Acknowledge Mention)
  socket.on('mark_mention_read', async ({ mentionId }) => {
      try {
          const mention = await prisma.mention.update({
              where: { id: mentionId },
              data: { isRead: true, readAt: new Date() },
              include: { 
                  message: { select: { id: true, userId: true } },
                  user: { select: { username: true } } // mentioned user
              }
          });
          
          // 1. Notify Sender (that their mention was acknowledged)
          io.to(`user_${mention.message.userId}`).emit('mention_read_status', { 
              mentionId: mention.id,
              messageId: mention.messageId,
              readByUserId: mention.userId,
              readByUsername: mention.user.username,
              readAt: mention.readAt
          });
          
          // 2. Notify Receiver (to update badge/list)
          io.to(`user_${mention.userId}`).emit('my_mention_updated', mention);

      } catch(e) { console.error(e); }
  });

  // 断开连接
      socket.on('disconnect', async (reason) => {
    console.log(`Socket disconnected. ID: ${socket.id}, Reason: ${reason}`);
    if (currentUser) {
        console.log(`Disconnected user: ${currentUser.username}`);
        // Cleanup only THIS specific socket entry
        // Use deleteMany to be safe, but filter by socketId strictly
        if (socket.id) {
            await prisma.device.deleteMany({ 
                where: { socketId: socket.id } 
            }).catch(e => console.error("Disconnect cleanup failed:", e.message));
        }
        io.to('general').emit('user_status', { userId: currentUser.id, status: 'offline' });
    }
  });
});

// 辅助函数: 消息删除逻辑
async function handleDeleteMessage(socket, messageId) {
    const currentUserId = socket.user.id;
    try {
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg) return;
        if (msg.userId !== currentUserId && currentUserId !== 1) throw new Error("Unauthorized");
        
        await prisma.message.update({
            where: { id: messageId },
            data: { 
                isDeleted: true, 
                isPinned: false,
                wasPinned: msg.isPinned // 记录之前的置顶状态
            } 
        });
        
        if (msg.isPinned) {
             io.to('general').emit('message_pinned', { messageId, isPinned: false });
        }

        io.to('general').emit('message_deleted', { messageId });
    } catch (e) { socket.emit('error', { message: e.message }); }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Industrial-Grade Server running on http://localhost:${PORT}`);
});
