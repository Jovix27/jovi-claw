import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
// @ts-ignore
import qrcode from 'qrcode-terminal';
import { logger } from "../utils/logger.js";
import { createBot } from "../bot/bot.js"; 
import { config } from "../config/env.js";

// Import the full Agent Loop instead of a simple chat
import { runAgentLoop } from "../agent/loop.js";

let whatsappClient: pkg.Client | null = null;
let isInitialized = false;

interface WhatsAppConfig {
    enabled: boolean;
    forwardToTelegram: boolean;
    autoReply: boolean;
    bossOnly: boolean; 
}

const waConfig: WhatsAppConfig = {
    enabled: true,
    forwardToTelegram: true,
    autoReply: true,
    bossOnly: true 
};

export const sendWhatsAppDM = async (number: string, text: string): Promise<void> => {
    if (whatsappClient && isInitialized) {
        // WhatsApp numbers expect @c.us for individuals
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        await whatsappClient.sendMessage(chatId, text);
        logger.info(`📱 Proactive WhatsApp sent to ${chatId}`);
    } else {
        throw new Error("WhatsApp client not ready.");
    }
};

export const startWhatsAppIntegration = async () => {
    logger.info("📱 Initializing WhatsApp Integration via Puppeteer...");

    whatsappClient = new Client({
        authStrategy: new LocalAuth({ dataPath: './whatsapp_auth_jovi' }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    whatsappClient.on('qr', (qr: string) => {
        logger.info("------------------------------------------------------------------");
        logger.info("📱 WhatsApp QR Code generated! Please scan it with your phone:");
        // Avoid type mapping issue with any
        const qrTerm: any = qrcode; 
        qrTerm.generate(qr, { small: true });
        logger.info("------------------------------------------------------------------");
    });

    whatsappClient.on('authenticated', () => {
        logger.info("📱 WhatsApp Authentication successful!");
    });

    whatsappClient.on('ready', () => {
        isInitialized = true;
        logger.info("📱 Jovi WhatsApp Agent is READY and connected!");
    });

    whatsappClient.on('auth_failure', (msg: string) => {
        logger.error(`📱 WhatsApp Authentication failed: ${msg}`);
    });

    whatsappClient.on('message', async (message: any) => {
        if (message.fromMe) return;

        const sender = message.from; 
        const isGroup = sender.endsWith('@g.us');
        const text = message.body as string;
        const lowerText = text.toLowerCase();

        // Check if Jovi is mentioned or it's a direct message
        const isMentioned = lowerText.includes('jovi') || text.includes('@Jovi');
        const shouldRespond = !isGroup || isMentioned;

        // Security: Identify the "Boss" (Authorized User)
        const bossUserId = config.security.allowedUserIds[0] || 0;
        const isBoss = sender.includes('8015164110'); // Simple match for your phone number

        logger.info(`📱 Message from ${sender} (${isGroup ? 'Group' : 'Direct'}): ${text}`);

        // Forwarding to Telegram (Mirroring)
        if (waConfig.forwardToTelegram) {
            const telegramBoss = config.security.allowedUserIds[0];
            if (telegramBoss) {
               try {
                   const telegramBot = createBot();
                   const groupTag = isGroup ? "👥 Group" : "👤 DM";
                   await telegramBot.api.sendMessage(
                       telegramBoss, 
                       `📱 **WA ${groupTag} from ${sender}:**\n${text}`,
                       { parse_mode: "Markdown" }
                   );
               } catch (e) {
                   logger.debug("Failed to forward WA msg to Telegram", { error: (e as Error).message });
               }
            }
        }

        // --- AGENT BRAIN INTEGRATION ---
        if (waConfig.autoReply && shouldRespond) {
              try {
                  // If it's the Boss, we give Jovi his full Agent "Hands" to use tools
                  // Otherwise, we could fall back to simple chat (but for now let's give the Boss full control)
                  const targetUserId = isBoss ? bossUserId : 0; 

                  logger.info(`🧠 Jovi Brain activating for WA message from ${sender}...`);
                  
                  // This is the core "Agent Loop" that handles tools, files, and logic
                  const result = await runAgentLoop(text, targetUserId);
                  
                  if (result.text) {
                       const responsePrefix = isGroup ? `👋 Hello Boss, ` : "";
                       await message.reply(`${responsePrefix}${result.text}`);
                       logger.info(`📱 Jovi Agent successfully replied on WhatsApp!`);
                  }
                  
                  // Check if the agent generated any visual files (screenshots, images)
                  // In a future update, we can add fs.readFileSync and client.sendMessage(chatId, media)
              } catch (err) {
                  logger.error("📱 Jovi WhatsApp Agent Error", { error: (err as Error).message });
                  await message.reply("⚠️ Sorry, I encountered a neural glitch while processing that request.");
              }
        }
    });

    whatsappClient.initialize().catch((err: Error) => {
         logger.error("Failed to initialize WhatsApp client.", { error: err.message });
    });
};

export const stopWhatsAppIntegration = async () => {
    if (whatsappClient && isInitialized) {
        logger.info("📱 Shutting down WhatsApp connection...");
        await whatsappClient.destroy();
        isInitialized = false;
    }
};
