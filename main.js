// Khởi tạo SignalR connection
const publisherConnection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:5118/signaling", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
    })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();

const subscriberConnection = new signalR.HubConnectionBuilder()
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

// Quản lý peer connections riêng biệt cho publisher và subscriber
let publisherPC = null;  // Để gửi media lên SFU
let subscriberPC = null; // Để nhận media từ SFU

let localStream = null;
let currentRoomId = null;
let publisherConnectionId = null;
let subscriberConnectionId = null;
let counter = 0;

let dataChannelPC1 = null;
let dataChannelPC2 = null;

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => errorMessage.style.display = 'none', 5000);
}

async function startSignalRPublisher() {
    try {
        await publisherConnection.start();
        console.log("SignalR Connected!");
        document.getElementById('publisherConnectionId').textContent = publisherConnectionId;
        joinRoomBtn.disabled = false;
    } catch (err) {
        console.error("SignalR Connection Error:", err);
        showError("Failed to connect to signaling server. Retrying...");
        setTimeout(startSignalR, 5000);
    }
}

async function startSignalRSubscriber() {
    try {
        await subscriberConnection.start();
        console.log("SignalR Connected!");
        document.getElementById('subscriberConnectionId').textContent = subscriberConnectionId;
        joinRoomBtn.disabled = false;
    } catch (err) {
        console.error("SignalR Connection Error:", err);
        showError("Failed to connect to signaling server. Retrying...");
        setTimeout(startSignalR, 5000);
    }
}

publisherConnection.on("ReceiveConnectionId", (connectionId) => {
    publisherConnectionId = connectionId;
    document.getElementById('publisherConnectionId').textContent = publisherConnectionId;
});
subscriberConnection.on("ReceiveConnectionId", (connectionId) => {
    subscriberConnectionId = connectionId;
    document.getElementById('subscriberConnectionId').textContent = subscriberConnectionId;
});

async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
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

        // Tạo publisher peer connection
        publisherPC = createPublisherConnection();
        const pubOffer = await publisherPC.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });

        // Sửa SDP cho publisher thành sendonly
        let pubSdp = pubOffer.sdp;
        pubSdp = pubSdp.replace(/a=sendrecv/g, 'a=sendonly');
        pubSdp = pubSdp.replace(/a=recvonly/g, 'a=sendonly');
        pubOffer.sdp = pubSdp;

        await publisherPC.setLocalDescription(pubOffer);

        // Gửi publisher offer đến SFU
        await publisherConnection.invoke("Join", roomId, JSON.stringify({
            target: "publisher",
            type: pubOffer.type,
            sdp: pubOffer.sdp
        }));

        // Tạo subscriber peer connection
        subscriberPC = createSubscriberConnection();
        const subOffer = await subscriberPC.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });

        // Sửa SDP cho subscriber thành recvonly
        let subSdp = subOffer.sdp;
        subSdp = subSdp.replace(/a=sendrecv/g, 'a=recvonly');
        subSdp = subSdp.replace(/a=sendonly/g, 'a=recvonly');
        subOffer.sdp = subSdp;

        await subscriberPC.setLocalDescription(subOffer);

        // Gửi subscriber offer đến SFU
        await subscriberConnection.invoke("Join", roomId, JSON.stringify({
            target: "subscriber",
            type: subOffer.type,
            sdp: subOffer.sdp
        }));


    } catch (err) {
        console.error("Error joining room:", err);
        showError("Failed to join room. Please try again.");
    }
}

function createPublisherConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: ["turn:3.27.194.134:3478"], username: "webrtcuser", credential: "webrtcc@123" },
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    pc.role = "publisher"; // ✅ Gán role để dễ phân biệt sau này
    console.log("📤 [PUBLISHER] PeerConnection created");

    // Thêm local tracks vào publisher
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`📤 [PUBLISHER] Adding track: kind=${track.kind}, id=${track.id}, enabled=${track.enabled}, state=${track.readyState}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.warn("⚠️ [PUBLISHER] localStream is null! Không thể add track");
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            publisherConnection.invoke("Trickle", JSON.stringify(event.candidate))
                .then(() => console.log("[PUBLISHER] ICE candidate sent"))
                .catch(err => console.error("[PUBLISHER] Error sending ICE candidate:", err));
        } else {
            console.log("[PUBLISHER] All ICE candidates sent");
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("[PUBLISHER] ICE connection state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
        console.log("[PUBLISHER] Signaling state:", pc.signalingState);
    };

    pc.onconnectionstatechange = () => {
        console.log("[PUBLISHER] Connection state:", pc.connectionState);
    };

    pc.ontrack = (event) => {
        console.warn("❌ [PUBLISHER] Received unexpected remote track:", event.track.kind, event.track.id);
        // Trường hợp này xảy ra nếu server (SFU) gửi media về nhầm peer
    };

    pc.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        console.log(`[DATACHANNEL] Received channel: ${receiveChannel.label}`);

        // Gán các trình xử lý sự kiện cho data channel vừa nhận được
        receiveChannel.onopen = () => {
            console.log(`[DATACHANNEL] Channel '${receiveChannel.label}' is now open.`);
            // Bạn có thể gửi một tin nhắn chào mừng khi kênh mở
            // receiveChannel.send("Hi there! Channel is open."); 
        };

        receiveChannel.onmessage = (event) => {
            console.log(`[DATACHANNEL] Message received: ${event.data}`);
            // Xử lý dữ liệu nhận được ở đây
        };

        receiveChannel.onclose = () => {
            console.log(`[DATACHANNEL] Channel '${receiveChannel.label}' has been closed.`);
        };

        receiveChannel.onerror = (error) => {
            console.error(`[DATACHANNEL] Error on channel '${receiveChannel.label}':`, error);
        };
    };

    return pc;
}


function createSubscriberConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: ["turn:3.27.194.134:3478"], username: "webrtcuser", credential: "webrtcc@123" },
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    pc.ontrack = (event) => {
        if (counter <= 1) {
            counter++;
            return;
        }
        console.log("[TRACK RECEIVED] peer type: publisher / subscriber?", pc === publisherPC ? "publisher" : "subscriber");
        console.log("track kind:", event.track.kind);
        console.log("stream ID:", event.streams[0]?.id);
        const stream = event.streams[0];
        if (!stream) return;
    
        console.log("🔊 New track from remote:", stream);
        console.log("📹 Video tracks:", stream.getVideoTracks());
        console.log("🎙 Audio tracks:", stream.getAudioTracks());
    
        const existing = document.getElementById(`remoteVideo-${stream.id}`);
        if (existing) {
            console.log("⚠️ Video element already exists for stream:", stream.id);
    
            // Gán lại srcObject để đảm bảo không mất liên kết
            existing.srcObject = stream;
            existing.play().catch(err => {
                console.warn("⚠️ Replay error:", err);
            });
            return;
        }
    
        // Tạo container cho video và label
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'remote-video-wrapper';
        videoWrapper.id = `wrapper-${stream.id}`;
    
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remoteVideo-${stream.id}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = true; // bắt buộc để autoplay không bị block
        remoteVideo.srcObject = stream;
    
        remoteVideo.onloadedmetadata = () => {
            remoteVideo.play().catch(err => {
                console.warn("Autoplay error:", err);
            });
        };
    
        // Label (tuỳ chọn, ví dụ: User ID)
        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = `User ${stream.id.slice(-4)}`; // hoặc gán theo connectionId nếu có
    
        videoWrapper.appendChild(remoteVideo);
        videoWrapper.appendChild(label);
        remoteVideos.appendChild(videoWrapper);
    };

    pc.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        console.log(`[DATACHANNEL] Received channel: ${receiveChannel.label}`);

        // Gán các trình xử lý sự kiện cho data channel vừa nhận được
        receiveChannel.onopen = () => {
            console.log(`[DATACHANNEL] Channel '${receiveChannel.label}' is now open.`);
            // Bạn có thể gửi một tin nhắn chào mừng khi kênh mở
            // receiveChannel.send("Hi there! Channel is open."); 
        };

        receiveChannel.onmessage = (event) => {
            console.log(`[DATACHANNEL] Message received: ${event.data}`);
            // Xử lý dữ liệu nhận được ở đây
        };

        receiveChannel.onclose = () => {
            console.log(`[DATACHANNEL] Channel '${receiveChannel.label}' has been closed.`);
        };

        receiveChannel.onerror = (error) => {
            console.error(`[DATACHANNEL] Error on channel '${receiveChannel.label}':`, error);
        };
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            subscriberConnection.invoke("Trickle", JSON.stringify(event.candidate))
                .catch(err => console.error("Error sending subscriber ICE candidate:", err));
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("[SUBSCRIBER] ICE connection state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
        console.log("[SUBSCRIBER] Signaling state:", pc.signalingState);
    };

    pc.onconnectionstatechange = () => {
        console.log("[SUBSCRIBER] Connection state:", pc.connectionState);
    };

    return pc;
}

// // Đăng ký handler này trên cả hai connection để đảm bảo không bỏ lỡ Offer
// publisherConnection.on("ReceiveOffer", (connectionId, offerData) => {
//     handleOffer(connectionId, offerData, 1); // type = 1
// });

// subscriberConnection.on("ReceiveOffer", (connectionId, offerData) => {
//     handleOffer(connectionId, offerData, 2); // type = 2
// });


// function detectOfferType(offerSdp) {
//     const sdp = typeof offerSdp === 'string' ? offerSdp : offerSdp.sdp;
//     if (sdp.includes('m=application')) return 'datachannel';
//     if (sdp.includes('m=video') || sdp.includes('m=audio')) return 'media';
//     return 'unknown';
// }

// function createDataChannelConnection() {
//     const pc = new RTCPeerConnection({
//         iceServers: [
//             { urls: ["turn:3.27.194.134:3478"], username: "webrtcuser", credential: "webrtcc@123" },
//             { urls: "stun:stun.l.google.com:19302" }
//         ]
//     });

//     pc.ondatachannel = (event) => {
//         const channel = event.channel;
//         console.log("[DATA] Received datachannel:", channel.label);

//         channel.onmessage = (e) => {
//             console.log("[DATA] Message:", e.data);
//         };

//         channel.onopen = () => console.log("[DATA] Datachannel opened");
//         channel.onclose = () => console.log("[DATA] Datachannel closed");
//     };

//     pc.onicecandidate = (event) => {
//         if (event.candidate) {
//             subscriberConnection.invoke("Trickle", JSON.stringify(event.candidate));
//         }
//     };

//     return pc;
// }

// async function handleOffer(connectionId, offerData, type) {
//     try {
//         const offer = typeof offerData === "string" ? JSON.parse(offerData) : offerData;
        
//         let pc;
//         let connection;
//         let pcType;

//         const offerType = detectOfferType(offer);

//         if (offerType === 'datachannel' && type == 1) {
//             pcType = 'datachannel1';
//             if (!dataChannelPC1) dataChannelPC1 = createDataChannelConnection();
//             pc = dataChannelPC1;
//             connection = publisherConnection;
//         } else if (offerType === 'datachannel' && type == 2) {
//             pcType = 'datachannel2';
//             if (!dataChannelPC2) dataChannelPC2 = createDataChannelConnection();
//             pc = dataChannelPC2;
//             connection = subscriberConnection;
//         } else if (offer.target === 'publisher') {
//             pcType = 'publisher';
//             if (!publisherPC) publisherPC = createPublisherConnection();
//             pc = publisherPC;
//             connection = publisherConnection;
//         } else {
//             pcType = 'subscriber';
//             if (!subscriberPC) subscriberPC = createSubscriberConnection();
//             pc = subscriberPC;
//             connection = subscriberConnection;
//         }
        

//         console.log(`[Offer Handler] Handling offer for target: ${pcType}`);
        
//         // Quy trình Offer/Answer tiêu chuẩn
//         await pc.setRemoteDescription(new RTCSessionDescription(offer));
//         console.log(`[Offer Handler] Set remote description for ${pcType} successful.`);

//         const answer = await pc.createAnswer();
//         await pc.setLocalDescription(answer);
//         console.log(`[Offer Handler] Created and set local description (answer) for ${pcType}.`);

//         // Gửi Answer lại qua connection tương ứng
//         await connection.invoke("Answer", JSON.stringify({
//             // Gửi lại target để server biết answer này dành cho ai
//             target: offer.target || pcType.split('/')[0], 
//             sdp: answer.sdp,
//             type: answer.type
//         }));
//         console.log(`[Offer Handler] Sent answer for ${pcType}.`);
        
//     } catch (err) {
//         console.error("Error handling offer:", err);
//         showError("Failed to process offer.");
//     }
// }

// // Xử lý offer từ SFU
// publisherConnection.on("ReceiveOffer", async (connectionId, offerData) => {
//     try {
//         const offer = typeof offerData === "string" ? JSON.parse(offerData) : offerData;
        
//         let pc;
//         let connection;
        
//         if (offer.target === 'publisher' || offer.target === 0) {
//             if (!publisherPC) {
//                 publisherPC = createPublisherConnection();
//             }
//             pc = publisherPC;
//             connection = publisherConnection;
//         } else {
//             if (!subscriberPC) {
//                 subscriberPC = createSubscriberConnection();
//             }
//             pc = subscriberPC;
//             connection = subscriberConnection;
//         }
        
//         await pc.setRemoteDescription(new RTCSessionDescription(offer));
//         const answer = await pc.createAnswer();
//         await pc.setLocalDescription(answer);

//         await connection.invoke("Answer", JSON.stringify({
//             target: offer.target || 'subscriber',
//             sdp: answer
//         }));
        
//     } catch (err) {
//         console.error("Error handling offer:", err);
//         showError("Failed to process offer.");
//     }
// });

publisherConnection.on("ReceiveAnswer", async (connectionId, answer) => {
    if (!publisherPC) return;

    try {
        const sdpAnswer = typeof answer === "string" ? JSON.parse(answer) : answer;

        console.log("📤 [Publisher] Received SDP Answer:");
        console.log(sdpAnswer.sdp); // <-- log SDP

        const desc = new RTCSessionDescription({
            type: sdpAnswer.type,
            sdp: sdpAnswer.sdp
        });
        await publisherPC.setRemoteDescription(desc);
    } catch (err) {
        console.error("❌ Error setting remote description for publisher:", err);
    }
});

subscriberConnection.on("ReceiveAnswer", async (connectionId, answer) => {
    if (!subscriberPC) return;

    try {
        const sdpAnswer = typeof answer === "string" ? JSON.parse(answer) : answer;

        console.log("📥 [Subscriber] Received SDP Answer:");
        console.log(sdpAnswer.sdp); // <-- log SDP

        const desc = new RTCSessionDescription({
            type: sdpAnswer.type,
            sdp: sdpAnswer.sdp
        });
        await subscriberPC.setRemoteDescription(desc);
    } catch (err) {
        console.error("❌ Error setting remote description for subscriber:", err);
    }
});


function parseCandidate(candidateData) {
    try {
        const parsed = typeof candidateData === "string" ? JSON.parse(candidateData) : candidateData;
        return parsed.candidate;
    } catch (err) {
        console.error("Failed to parse ICE candidate:", err);
        return null;
    }
}

publisherConnection.on("ReceiveIceCandidate", async (connectionId, candidateData) => {
    const candidateObj = parseCandidate(candidateData);
    if (!candidateObj || !publisherPC) return;

    try {
        await publisherPC.addIceCandidate(new RTCIceCandidate(candidateObj));
    } catch (err) {
        console.error("Error adding candidate for publisher:", err);
    }
});

subscriberConnection.on("ReceiveIceCandidate", async (connectionId, candidateData) => {
    const candidateObj = parseCandidate(candidateData);
    if (!candidateObj || !subscriberPC) return;

    try {
        await subscriberPC.addIceCandidate(new RTCIceCandidate(candidateObj));
    } catch (err) {
        console.error("Error adding candidate for subscriber:", err);
    }
});

publisherConnection.onclose(() => {
    showError("Lost connection to server. Reconnecting...");
    joinRoomBtn.disabled = true;
    cleanupAllPeerConnections();
});

subscriberConnection.onclose(() => {
    showError("Lost connection to server. Reconnecting...");
    joinRoomBtn.disabled = true;
    cleanupAllPeerConnections();
});

function cleanupPeerConnection(pc, type) {
    if (pc) {
        pc.close();
    }
}

function cleanupAllPeerConnections() {
    cleanupPeerConnection(publisherPC, "publisher");
    cleanupPeerConnection(subscriberPC, "subscriber");
    publisherPC = null;
    subscriberPC = null;
    
    // Xóa remote videos
    const remoteVideo = document.getElementById("remoteVideo-subscriber");
    if (remoteVideo) remoteVideo.remove();
}

// Khởi tạo
startSignalRPublisher();
startSignalRSubscriber();
initLocalStream();