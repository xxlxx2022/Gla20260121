const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

// --- 1. 极速启动配置 ---
const PORT = process.env.PORT || 3000;
const UUID = process.env.UUID || '31c3e9f4-d9c2-47cc-8e31-bdd00c6281ce';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const ABS_FILE_PATH = path.resolve(process.cwd(), FILE_PATH);

// --- 2. ⚡️ 优先级最高的路由 (确保 100% 通过健康检查) ---

// 针对根路径的强制响应
app.get("/", (req, res) => {
    res.status(200).send(`✅ Service is Running. UUID: ${UUID}`);
});

// 健康检查专用接口
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

// 订阅地址 (动态读取文件，防止启动时文件不存在导致报错)
app.get(`/${SUB_PATH}`, (req, res) => {
    const subFile = path.join(ABS_FILE_PATH, 'sub.txt');
    if (fs.existsSync(subFile)) {
        res.type('text/plain').send(fs.readFileSync(subFile, 'utf-8'));
    } else {
        res.status(503).send("Initializing nodes... please wait.");
    }
});

// --- 3. 启动服务器 (绑定 0.0.0.0) ---
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
    // 服务器启动确认后，才开始干活
    runBackgroundLogic();
});

// --- 4. 后台业务逻辑 (脏活累活全放这里) ---
async function runBackgroundLogic() {
    console.log("⚙️ Starting background logic...");
    
    // 确保目录存在
    if (!fs.existsSync(ABS_FILE_PATH)) fs.mkdirSync(ABS_FILE_PATH, { recursive: true });

    // 环境变量
    const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
    const NEZHA_PORT = process.env.NEZHA_PORT || '';
    const NEZHA_KEY = process.env.NEZHA_KEY || '';
    const ARGO_AUTH = process.env.ARGO_AUTH || '';
    const ARGO_PORT = process.env.ARGO_PORT || 8001;
    const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
    const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
    const CFPORT = process.env.CFPORT || 443;
    const NAME = process.env.NAME || 'Galaxy';
    const UPLOAD_URL = process.env.UPLOAD_URL || '';
    const PROJECT_URL = process.env.PROJECT_URL || '';

    // 定义文件名
    const webName = 'web';
    const botName = 'bot';
    const npmName = 'npm';
    const phpName = 'php';
    const webPath = path.join(ABS_FILE_PATH, webName);
    const botPath = path.join(ABS_FILE_PATH, botName);
    const npmPath = path.join(ABS_FILE_PATH, npmName);
    const phpPath = path.join(ABS_FILE_PATH, phpName);
    const configPath = path.join(ABS_FILE_PATH, 'config.json');
    const subFilePath = path.join(ABS_FILE_PATH, 'sub.txt');

    // 清理旧文件
    [webPath, botPath, npmPath, phpPath, configPath].forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

    // 辅助：下载文件
    const download = (url, dest) => {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            axios({ url, method: 'GET', responseType: 'stream' })
                .then(response => {
                    response.data.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                    file.on('error', err => { fs.unlink(dest, ()=>{}); reject(err); });
                }).catch(err => reject(err));
        });
    };

    // 辅助：判断架构
    const arch = os.arch();
    const isArm = arch === 'arm' || arch === 'arm64' || arch === 'aarch64';
    const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";

    try {
        // 1. 生成 Config
        const config = {
            log: { access: "/dev/null", error: "/dev/null", loglevel: "none" },
            inbounds: [
                { port: ARGO_PORT, protocol: "vless", settings: { clients: [{ id: UUID, flow: "xtls-rprx-vision" }], decryption: "none", fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }] }, streamSettings: { network: "tcp" } },
                { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
                { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } } },
                { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } } }
            ],
            outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // 2. 下载核心文件
        const tasks = [
            download(`${baseUrl}/web`, webPath),
            download(`${baseUrl}/bot`, botPath)
        ];
        if (NEZHA_SERVER) {
            if (NEZHA_PORT) tasks.push(download(`${baseUrl}/agent`, npmPath));
            else tasks.push(download(`${baseUrl}/v1`, phpPath));
        }
        await Promise.all(tasks);

        // 3. 授权并运行
        [webPath, botPath, npmPath, phpPath].forEach(p => { if(fs.existsSync(p)) fs.chmodSync(p, 0o775); });

        // 运行 Xray
        exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`);

        // 运行 Nezha
        if (NEZHA_SERVER) {
            if (NEZHA_PORT) {
                // Agent 模式
                let tls = ['443', '8443', '2096'].includes(NEZHA_PORT) ? '--tls' : '';
                exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tls} --disable-auto-update --skip-conn --skip-procs >/dev/null 2>&1 &`);
            } else {
                // V1 模式
                let tls = ['443', '8443', '2096'].includes(NEZHA_SERVER.split(':')[1]||'') ? 'true' : 'false';
                let conf = `client_secret: ${NEZHA_KEY}\nserver: ${NEZHA_SERVER}\ntls: ${tls}\nuuid: ${UUID}`;
                fs.writeFileSync(path.join(ABS_FILE_PATH, 'config.yaml'), conf);
                exec(`nohup ${phpPath} -c "${ABS_FILE_PATH}/config.yaml" >/dev/null 2>&1 &`);
            }
        }

        // 运行 Argo
        if (fs.existsSync(botPath)) {
            let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://localhost:${ARGO_PORT}`;
            if (ARGO_AUTH && ARGO_AUTH.length > 20) {
                 args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
            }
            exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
        }

        // 4. 生成订阅 (稍作延时)
        setTimeout(async () => {
            let domain = ARGO_DOMAIN || 'waiting.for.domain';
            let vless = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&type=ws&host=${domain}&path=%2Fvless-argo#${NAME}`;
            fs.writeFileSync(subFilePath, Buffer.from(vless).toString('base64'));
            
            // 上传
            if (UPLOAD_URL && PROJECT_URL) {
                axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [`${PROJECT_URL}/${SUB_PATH}`] }).catch(()=>{});
            }
        }, 5000);

        // 5. 自动保活
        if (PROJECT_URL) axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }).catch(()=>{});

    } catch (err) {
        console.error("Setup Error:", err);
    }
}
