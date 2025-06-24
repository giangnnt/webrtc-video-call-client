// Khởi tạo SignalR connection
const connection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:5118/signaling", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
    })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();

// Biến toàn cục
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const roomIdInput = document.getElementById('roomId');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const errorMessage = document.getElementById('errorMessage');
const peerConnections = new Map();
let localStream = null;
let currentRoomId = null;
let thisConnectionId = null;

// Hiển thị thông báo lỗi
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 5000);
}

// Khởi động SignalR
async function startSignalR() {
    try {
        await connection.start();
        console.log("✅ SignalR Connected!");
        document.getElementById('connectionId').textContent = connection.connectionId;
        joinRoomBtn.disabled = false;
    } catch (err) {
        console.error("❌ SignalR Connection Error:", err);
        showError("Failed to connect to signaling server. Retrying...");
        setTimeout(startSignalR, 5000);
    }
}

// Khởi tạo local stream
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Failed to access camera/microphone:", err);
        showError("Cannot access camera or microphone. Please check permissions.");
    }
}

// Tạo ID phòng ngẫu nhiên
function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

// Tạo phòng mới
async function createRoom() {
    const roomId = generateRoomId();
    roomIdInput.value = roomId;
    await joinRoom();
}

async function joinRoom() {
    const roomId = roomIdInput.value.trim();
    if (!roomId) {
        showError("Please enter a room ID");
        return;
    }
    try {
        currentRoomId = roomId;
        const pc = createPeerConnection(thisConnectionId);
        const offer = await pc.createOffer();
        console.log(`[OFFER] Created offer:`, offer);

        await pc.setLocalDescription(offer);
        console.log(`[OFFER] Local description set`);

        await connection.invoke("Join", roomId, JSON.stringify(offer));
        console.log(`[SIGNALING] Sent Join with offer to room ${roomId}`);
    } catch (err) {
        console.error("Error joining room:", err);
        showError("Failed to join room. Please try again.");
    }
}



// Tạo peer connection
function createPeerConnection(connectionId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: ["turn:3.27.194.134:3478"],
                username: "webrtcuser",
                credential: "webrtcc@123"
            },
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    // Thêm local stream
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Xử lý remote stream
    pc.ontrack = (event) => {
        console.log(`Received remote track from ${connectionId}`);
        let remoteVideo = document.getElementById(`remoteVideo-${connectionId}`);
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remoteVideo-${connectionId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsinline = true;
            remoteVideos.appendChild(remoteVideo);
        }
        remoteVideo.srcObject = event.streams[0];
    };

    // Xử lý ICE candidate
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`[TRICKLE] ConnectionId: ${connectionId} - Sending ICE candidate:`, event.candidate);
            connection.invoke("Trickle", JSON.stringify(event.candidate))
                .then(() => {
                    console.log(`[TRICKLE] ConnectionId: ${connectionId} - ICE candidate sent successfully.`);
                })
                .catch(err => {
                    console.error(`[TRICKLE] ConnectionId: ${connectionId} - Error sending ICE candidate:`, err);
                });
        } else {
            console.log(`[TRICKLE] ConnectionId: ${connectionId} - All ICE candidates have been sent (null candidate).`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            console.log('WebRTC connection established successfully!');
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            console.error('WebRTC connection failed or disconnected');
        }
    };

    peerConnections.set(connectionId, pc);
    return pc;
}

connection.on("ReceiveConnectionId", async (connectionId) => {
    console.log(`Received connection ID: ${connectionId}`);
    document.getElementById('connectionId').textContent = connectionId;
    thisConnectionId = connectionId
});

connection.on("ReceiveOffer", async (connectionId, offer) => {
    console.log(`[SIGNALING] Received offer from ${connectionId}`);
    const pc = createPeerConnection(connectionId);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
        console.log(`[SDP] Remote description (offer) set for ${connectionId}`);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[SDP] Created and set local answer for ${connectionId}`);

        await connection.invoke("Answer", JSON.stringify(answer));
        console.log(`[SIGNALING] Sent answer back to SFU for ${connectionId}`);
    } catch (err) {
        console.error("Error handling offer:", err);
        showError("Failed to process offer.");
    }
});


connection.on("ReceiveAnswer", async (connectionId, answer) => {
    console.log(`[SIGNALING] Received answer from ${connectionId}:`, answer);
    const pc = peerConnections.get(connectionId);
    if (pc) {
        try {
            await pc.setRemoteDescription({
                type: "answer",
                sdp: answer
              });              
            console.log(`[SDP] Remote description (answer) set for ${connectionId}`);
        } catch (err) {
            console.error("Error handling answer:", err);
            showError("Failed to process answer.");
        }
    }
});

connection.on("ReceiveIceCandidate", async (connectionId, candidate) => {
    console.log(`[SIGNALING] Received ICE candidate from ${connectionId}:`, candidate);
    const pc = peerConnections.get(connectionId);
    if (pc && candidate) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
            console.log(`[ICE] Candidate added for ${connectionId}`);
        } catch (err) {
            console.error("Error adding ICE candidate:", err);
        }
    }
});


// // Xử lý sự kiện user join
// connection.on("UserJoined", (connectionId) => {
//     console.log(`User ${connectionId} joined the room`);
//     if (!peerConnections.has(connectionId)) {
//         const pc = createPeerConnection(connectionId);
//         sendOffer(connectionId, pc);
//     }
// });

// // Xử lý sự kiện user leave
// connection.on("UserLeft", (connectionId) => {
//     console.log(`User ${connectionId} left the room`);
//     cleanupPeerConnection(connectionId);
// });

// Dọn dẹp peer connection
function cleanupPeerConnection(connectionId) {
    const pc = peerConnections.get(connectionId);
    if (pc) {
        pc.close();
        peerConnections.delete(connectionId);
        const remoteVideo = document.getElementById(`remoteVideo-${connectionId}`);
        if (remoteVideo) remoteVideo.remove();
    }
}

// // Gửi offer
// async function sendOffer(connectionId, pc) {
//     try {
//         const offer = await pc.createOffer();
//         await pc.setLocalDescription(offer);
//         await connection.invoke("Offer", JSON.stringify(offer));
//     } catch (err) {
//         console.error("Error sending offer:", err);
//         showError("Failed to send offer.");
//     }
// }

// Xử lý ngắt kết nối SignalR
connection.onclose(() => {
    console.log("SignalR connection closed");
    showError("Lost connection to server. Reconnecting...");
    joinRoomBtn.disabled = true;
    cleanupAllPeerConnections();
});

// Dọn dẹp tất cả peer connections
function cleanupAllPeerConnections() {
    peerConnections.forEach((pc, connectionId) => {
        pc.close();
        const remoteVideo = document.getElementById(`remoteVideo-${connectionId}`);
        if (remoteVideo) remoteVideo.remove();
    });
    peerConnections.clear();
}

// Khởi động ứng dụng
startSignalR();
initLocalStream();