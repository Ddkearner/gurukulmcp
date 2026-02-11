const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

server.stdout.on('data', (data) => {
    console.log(`STDOUT: ${data}`);
});

server.stderr.on('data', (data) => {
    console.error(`STDERR: ${data}`);
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
});

const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
            name: "test-client",
            version: "1.0.0"
        }
    }
};

const listToolsRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
};

// Send requests
server.stdin.write(JSON.stringify(initRequest) + '\n');

setTimeout(() => {
    server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
}, 1000);

setTimeout(() => {
    process.exit(0);
}, 3000);
