// Create SignalR connection
const connection = new signalR.HubConnectionBuilder()
// replace with your signaling server
    .withUrl("http:your-signaling-server/signaling", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
    })
    .build();

// Start SignalR connection
async function startSignalR() {
    try {
        await connection.start();
        console.log("✅ SignalR Connected!");
        document.getElementById('sendOfferBtn').disabled = false;
    } catch (err) {
        console.error("❌ SignalR Connection Error:", err);
        // try to reconnect after 5 seconds
        setTimeout(startSignalR, 5000);
    }
}
 
// receive connection id from signaling server
connection.on("ReceiveConnectionId", (connectionId) => {
    console.log("Received connection ID:", connectionId);
    document.getElementById('connectionId').textContent = connectionId;
});

// start signalr connection
startSignalR();

// map to store peer connections
const peerConnections = new Map();
let localStream = null;


// init the local stream (the camera and microphone of your browser)
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;
    } catch (err) {
        console.error("Failed to access camera/microphone", err);
    }
}

// Call this at the beginning
initLocalStream();


// create peer connection
// the peer connection is used to send and receive media streams to the other peer
// it also used to send and receive ice candidates from stun server to the other peer
function createPeerConnection(connectionId) {
    const pc = new RTCPeerConnection({
        iceServers: [
          {
            // replace with your turn server
            urls: [
              "turn:global.relay.metered.ca:80",
              "turn:global.relay.metered.ca:443",
              "turn:global.relay.metered.ca:443?transport=tcp"
            ],
            username: "0f6cc54d4b1286b627388ab2",
            credential: "/+DdwhB2BKSQB2Z0"
          },
          // stun server (choose google or your own)
          {
            urls: "stun:stun.l.google.com:19302"
          }
        ]
      });
      

    // the local stream contain the camera and microphone of your browser, 2 tracks in total
    // for each track, we need to add it to the peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // when receive remote track from peer, we need to add it to the remote video element
    pc.ontrack = (event) => {
        console.log("Received remote track");
        const remoteVideo = document.getElementById("remoteVideo");
        remoteVideo.srcObject = event.streams[0];
    };

    // when receive ice candidate from stun server, we need to send it to the signaling server
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            connection.invoke("SendIceCandidate", connectionId, JSON.stringify(event.candidate));
        }
    };

    // log the ice connection state
    pc.oniceconnectionstatechange = () => {
        console.log("ICE State:", pc.iceConnectionState);
    };

    // store the peer connection in the map
    peerConnections.set(connectionId, pc);
    return pc;
}

// receive offer from signaling server
connection.on("ReceiveOffer", async (connectionId, offer) => {
    console.log("Received offer from:", connectionId);
    const peerConnection = createPeerConnection(connectionId);
    // set the remote description of the peer connection
    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));

    // create answer and set the local description of the peer connection
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await connection.invoke("SendAnswer", connectionId, JSON.stringify(answer));
});

// receive answer from signaling server
connection.on("ReceiveAnswer", async (connectionId, answer) => {
    console.log("Received answer from:", connectionId);
    const peerConnection = peerConnections.get(connectionId);
    if (peerConnection) {
        // set the remote description of the peer connection
        await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
    }
});

// receive ice candidate from signaling server
connection.on("ReceiveIceCandidate", async (connectionId, candidate) => {
    console.log("Received ICE candidate from:", connectionId);
    const peerConnection = peerConnections.get(connectionId);
    if (peerConnection && candidate) {
        try {
            // add the ice candidate to the peer connection
            await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
        } catch (err) {
            console.error("Error adding received ICE candidate", err);
        }
    }
});

// send offer to the signaling server
async function sendOffer() {
    const targetId = document.getElementById("targetId").value;
    if (!targetId) {
        alert("Please enter target connection ID");
        return;
    }

    const peerConnection = createPeerConnection(targetId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await connection.invoke("SendOffer", targetId, JSON.stringify(offer));
}

document.getElementById('sendOfferBtn').addEventListener('click', sendOffer);
