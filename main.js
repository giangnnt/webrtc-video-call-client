// main.js

const connection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:5118/signaling", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
    })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const roomIdInput = document.getElementById('roomId');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const errorMessage = document.getElementById('errorMessage');
const infoMessage = document.getElementById('infoMessage');
const peerConnections = new Map();
let localStream = null;
let currentRoomId = null;
let thisConnectionId = null;

// Map lưu connectionId <-> index của ô video
const remoteVideoSlots = new Map();

// Hàm tìm ô video trống
function getAvailableVideoSlot() {
    for (let i = 0; i < 6; i++) {
        if (![...remoteVideoSlots.values()].includes(i)) {
            return i;
        }
    }
    return null; // Hết slot
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 5000);
}

function showInfo(message) {
    infoMessage.textContent = message;
    infoMessage.style.display = 'block';
    setTimeout(() => infoMessage.style.display = 'none', 5000);
}

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

async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Failed to access camera/microphone:", err);
        showError("Cannot access camera or microphone. Please check permissions.");
    }
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

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
        await pc.setLocalDescription(offer);
        await connection.invoke("Join", roomId, JSON.stringify(offer));
    } catch (err) {
        console.error("Error joining room:", err);
        showError("Failed to join room. Please try again.");
    }
}

function createPeerConnection(connectionId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: ["turn:3.27.194.134:3478"],
                username: "webrtcuser",
                credential: "webrtcc@123"
            },
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        let slotIndex = remoteVideoSlots.get(connectionId);
        if (slotIndex === undefined) {
            slotIndex = getAvailableVideoSlot();
            if (slotIndex === null) {
                console.warn('No available video slot for new peer!');
                return;
            }
            remoteVideoSlots.set(connectionId, slotIndex);
        }
        const remoteVideo = document.getElementById(`remoteVideo-${slotIndex}`);
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.style.display = 'block';
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            connection.invoke("Trickle", JSON.stringify(event.candidate))
                .then(() => console.log(`ICE candidate sent for ${connectionId}`))
                .catch(err => console.error(`Error sending ICE candidate for ${connectionId}:`, err));
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${connectionId}: ${pc.iceConnectionState}`);
    };

    peerConnections.set(connectionId, pc);
    return pc;
}

connection.on("ReceiveConnectionId", async (connectionId) => {
    thisConnectionId = connectionId;
    document.getElementById('connectionId').textContent = connectionId;
});

connection.on("ReceiveOffer", async (connectionId, offer) => {
    const pc = createPeerConnection(connectionId);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await connection.invoke("Answer", JSON.stringify(answer));
    } catch (err) {
        console.error("Error handling offer:", err);
        showError("Failed to process offer.");
    }
});

connection.on("ReceiveAnswer", async (connectionId, answer) => {
    const pc = peerConnections.get(connectionId);
    if (pc) {
        try {
            await pc.setRemoteDescription({ type: "answer", sdp: answer });
        } catch (err) {
            console.error("Error handling answer:", err);
            showError("Failed to process answer.");
        }
    }
});

connection.on("ReceiveIceCandidate", async (connectionId, candidate) => {
    const pc = peerConnections.get(connectionId);
    if (pc && candidate) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
        } catch (err) {
            console.error("Error adding ICE candidate:", err);
        }
    }
});

connection.on("PeerJoined", (peerId) => {
    console.log(`User ${peerId} joined the room.`);
    showInfo(`User ${peerId} joined the room.`);
    // You may create a video placeholder if you want
    if (!document.getElementById(`remoteVideo-${peerId}`)) {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remoteVideo-${peerId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideos.appendChild(remoteVideo);
    }
});

connection.onclose(() => {
    console.log("SignalR connection closed");
    showError("Lost connection to server. Reconnecting...");
    joinRoomBtn.disabled = true;
    cleanupAllPeerConnections();
});

function cleanupAllPeerConnections() {
    peerConnections.forEach((pc, connectionId) => {
        cleanupPeerConnection(connectionId);
    });
    peerConnections.clear();
}

function cleanupPeerConnection(connectionId) {
    const pc = peerConnections.get(connectionId);
    if (pc) {
        pc.close();
        peerConnections.delete(connectionId);
        const slotIndex = remoteVideoSlots.get(connectionId);
        if (slotIndex !== undefined) {
            const remoteVideo = document.getElementById(`remoteVideo-${slotIndex}`);
            if (remoteVideo) {
                remoteVideo.srcObject = null;
                remoteVideo.style.display = 'none';
            }
            remoteVideoSlots.delete(connectionId);
        }
    }
}

startSignalR();
initLocalStream();
