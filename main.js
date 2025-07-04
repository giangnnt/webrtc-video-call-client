// Init SignalR connection
const signalingConnection = new signalR.HubConnectionBuilder()
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

let localStream = null;
let currentRoomId = null;
let signalingConnectionId = null;
// subscriber peer connection
let subPeerConnection = null;
// publisher peer connection
let pubPeerConnection = null;
// is init
let isInit = true;


function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 5000);
}

async function startSignaling() {
    try {
        await signalingConnection.start();
        console.log("Media SignalR Connected!");
        joinRoomBtn.disabled = false;
    } catch (err) {
        console.error("SignalR Connection Error:", err);
        showError("Failed to connect to signaling server. Retrying...");
        setTimeout(startSignaling, 5000);
    }
}

signalingConnection.on("ReceiveConnectionId", (receivedConnectionId) => {
    signalingConnectionId = receivedConnectionId;
    document.getElementById('connectionId').textContent = signalingConnectionId;
});

async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
        });
        if (localVideo) {
            localVideo.srcObject = localStream;
        }

        // use to track
        await signalingConnection.invoke("SetStreamPeerId", localStream.id);
        console.log("✅ Local stream initialized");
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
// send a join request (publisher) to SFU, create pub sub peer connection
async function joinRoom() {
    const roomId = roomIdInput.value.trim();

    if (!roomId) {
        showError("Please enter a room ID");
        return;
    }

    // check local stream
    if (!localStream) {
        showError("Local stream not ready. Please wait...");
        return;
    }

    try {
        currentRoomId = roomId;
        console.log(`🚪 Joining room: ${roomId}`);
    
        // create init peer connection
        subPeerConnection = createSubcriberPeerConnection();

        pubPeerConnection = createPublisherPeerConnection();
        
        const offer = await pubPeerConnection.createOffer();
        await pubPeerConnection.setLocalDescription(offer);
    
        console.log("📤 Sending offer to SFU...");
        await signalingConnection.invoke("Join", roomId, JSON.stringify({
            type: offer.type,
            sdp: offer.sdp,
        }));
    } catch (err) {
        console.error("Error joining room:", err);
        showError("Failed to join room. Please try again.");
    }
    
}
// create publisher peer connection
// add local tracks to publisher peer connection
function createPublisherPeerConnection() {
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
        console.log("📹 Adding local tracks to peer connection...");
        localStream.getTracks().forEach(track => {
            console.log(`Adding track: ${track.kind}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.warn("⚠️ localStream is null! Không thể add track");
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("🧊 Sending ICE candidate");
            signalingConnection.invoke("Trickle", JSON.stringify(event.candidate))
                .then(() => console.log("ICE candidate sent"))
                .catch(err => console.error("Error sending ICE candidate:", err));
        } else {
            console.log("🧊 All ICE candidates sent");
        }
    };

    pc.onsignalingstatechange = () => {
        console.log("📡 Signaling state:", pc.signalingState);
    };
    pc.onconnectionstatechange = () => {
        console.log("🔗 Connection state:", pc.connectionState);
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log("🧊 ICE connection state:", pc.iceConnectionState);
    };
    
    pc.onicegatheringstatechange = () => {
        console.log("🧊 ICE gathering state:", pc.iceGatheringState);
    };

    return pc;
}
// create subscriber peer connection
// receive remote tracks from SFU
// receive data channel from SFU
function createSubcriberPeerConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: ["turn:35.197.146.171:3478"],
                username: "webrtc",
                credential: "supersecret"
              },
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("🧊 Sending ICE candidate");
            signalingConnection.invoke("Trickle", JSON.stringify(event.candidate))
                .then(() => console.log("ICE candidate sent"))
                .catch(err => console.error("Error sending ICE candidate:", err));
        } else {
            console.log("🧊 All ICE candidates sent");
        }
    };
    
    pc.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        console.log(`📡 Received data channel from SFU: ${receiveChannel.label}`);
    };

    pc.ontrack = async (event) => {
        console.log("🎬 Received remote track:", event.track.kind);
        const stream = event.streams[0];
        if (!stream) {
            console.warn("⚠️ No stream in track event");
            return;
        }
        const peerId = await signalingConnection.invoke("GetPeerIdByStreamId", stream.id);
        
        const streamId = stream.id;
        const existing = document.getElementById(`remoteVideo-${streamId}`);
        
        if (existing) {
            console.log("⚠️ Video element already exists for stream:", streamId);
            existing.srcObject = stream;
            existing.play().catch(err => {
                console.warn("⚠️ Replay error:", err);
            });
            return;
        }
    
        // Tạo video element mới
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'remote-video-wrapper';
        videoWrapper.id = `wrapper-${streamId}`;
        videoWrapper.style.cssText = `
            position: relative;
            display: inline-block;
            margin: 10px;
            border: 2px solid #333;
            border-radius: 8px;
        `;
    
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remoteVideo-${streamId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false; // Allow audio for remote videos
        remoteVideo.style.cssText = `
            width: 300px;
            height: 200px;
            object-fit: cover;
        `;
        remoteVideo.srcObject = stream;
    
        const label = document.createElement('div');
        label.className = 'video-label';

        label.textContent = `User ${peerId}`;
        label.style.cssText = `
            position: absolute;
            bottom: 5px;
            left: 5px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
        `;
    
        videoWrapper.appendChild(remoteVideo);
        videoWrapper.appendChild(label);
        remoteVideos.appendChild(videoWrapper);
        
        console.log("✅ Remote video element created for stream:", streamId);
    
    };
    
    pc.onsignalingstatechange = () => {
        console.log("📡 Signaling state:", pc.signalingState);
    };
    pc.onconnectionstatechange = () => {
        console.log("🔗 Connection state:", pc.connectionState);
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log("🧊 ICE connection state:", pc.iceConnectionState);
    };
    
    pc.onicegatheringstatechange = () => {
        console.log("🧊 ICE gathering state:", pc.iceGatheringState);
    };

    return pc;
}

signalingConnection.on("PeerJoined", async (peerId) => {
    console.log("📥 Received peerId from SFU", peerId);
});

// Handle offers from SFU
signalingConnection.on("ReceiveOffer", async (receivedConnectionId, offerData) => {
    console.log("📥 Received offer from SFU");
    try {
        console.log("🔄 Processing offer from SFU...");
        const offer = typeof offerData === "string" ? JSON.parse(offerData) : offerData;
        await subPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("✅ Remote description set");
        // 
        if (isInit) {
            isInit = false;
            const answer = await subPeerConnection.createAnswer();
            await subPeerConnection.setLocalDescription(answer);            
    
            console.log("✅ Local description set");
            await signalingConnection.invoke("Answer", answer.sdp);
            console.log("📤 Answer sent to SFU");
        } else {
            const answer = await subPeerConnection.createAnswer();
            await subPeerConnection.setLocalDescription(answer);
            
            console.log("✅ Local description set");
            await signalingConnection.invoke("Answer", answer.sdp);
            console.log("📤 Answer sent to SFU");
        } 
        }catch (err) {
            console.error("❌ Error processing offer from SFU:", err);
            showError("Failed to process offer from SFU.");
        }
});

// Handle answers from SFU
signalingConnection.on("ReceiveAnswer", async (receivedConnectionId, answer) => {
    try {
        console.log("📥 Received answer from SFU");
        const sdpAnswer = typeof answer === "string" ? JSON.parse(answer) : answer;

        const desc = new RTCSessionDescription({
            type: sdpAnswer.type,
            sdp: sdpAnswer.sdp
        });

        // if (isInit) {
            await pubPeerConnection.setRemoteDescription(desc);
            console.log("✅ Answer processed successfully");
            return;
        // }
        
        // await subPeerConnection.setRemoteDescription(desc);
        // console.log("✅ Answer processed successfully");
        
    } catch (err) {
        console.error("❌ Error setting remote description:", err);
        showError("Failed to process answer from SFU.");
    }
});

let count = 0;
// the isPub is sent from signaling, to accurately add ice candidate to the correct peer connection
signalingConnection.on("ReceiveIceCandidate", async (receivedConnectionId, candidateData, isPub) => {
    
    console.log("📥 Received ICE candidate from SFU", count++);

    const candidateObj = parseCandidate(candidateData);
    try {
        if (isPub) {
            await pubPeerConnection.addIceCandidate(new RTCIceCandidate(candidateObj));
            console.log("🧊 ICE candidate added");
        } else {
            await subPeerConnection.addIceCandidate(new RTCIceCandidate(candidateObj));
            console.log("🧊 ICE candidate added");
        }
    } catch (err) {
        console.error("❌ Error adding ICE candidate:", err);
    }
});

function parseCandidate(candidateData) {
    try {
        const parsed = typeof candidateData === "string" ? JSON.parse(candidateData) : candidateData;

        // Một số SFU gửi theo dạng: { candidate: { candidate: "candidate:..." } }
        if (parsed.candidate && typeof parsed.candidate === "object") {
            return parsed.candidate;
        }

        return parsed.candidate || parsed;
    } catch (err) {
        console.error("❌ Failed to parse ICE candidate:", err);
        return null;
    }
}

// Handle disconnection
signalingConnection.onclose(() => {
    console.log("🔌 SignalR connection closed");
    showError("Lost connection to server. Reconnecting...");
    joinRoomBtn.disabled = true;
    cleanupAllPeerConnections();
});

signalingConnection.on("PeerDisconnected", async (peerId) => {
    console.log("🔌 Peer disconnected", peerId);
    // remove the remote video element
    const streamId = await signalingConnection.invoke("GetStreamIdByPeerId", peerId);
    const wrapper = document.getElementById(`wrapper-${streamId}`);
    if (wrapper) {
        wrapper.remove();
    }
});

// Cleanup functions
function cleanupPeerConnection(pc) {
    if (pc) {
        pc.close();
        console.log("🧹 Peer connection cleaned up");
    }
}

function cleanupAllPeerConnections() {
    subPeerConnection = null;
    pubPeerConnection = null;
    // remove all remote videos
    const wrappers = document.querySelectorAll('.remote-video-wrapper');
    wrappers.forEach(wrapper => wrapper.remove());
    
    console.log("🧹 All connections cleaned up");
}

// Khởi tạo
console.log("🚀 Initializing Signaling");
startSignaling();
initLocalStream();