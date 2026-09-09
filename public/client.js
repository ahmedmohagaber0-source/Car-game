(function(){
  const joinScreen = document.getElementById('join');
  const gameScreen = document.getElementById('game');
  const nameInput = document.getElementById('nameInput');
  const roomInput = document.getElementById('roomInput');
  const joinBtn = document.getElementById('joinBtn');
  const playersList = document.getElementById('playersList');
  const roleBanner = document.getElementById('roleBanner');
  const driveBtn = document.getElementById('driveBtn');
  const blindOverlay = document.getElementById('blindOverlay');
  const gameoverBox = document.getElementById('gameoverBox');
  const finalScore = document.getElementById('finalScore');
  const micIcon = document.getElementById('micIcon');
  const audioHolder = document.getElementById('audioHolder');

  let socket, myId, room, myName;
  let peer, myStream;
  const remoteCalls = {};
  const remoteAudioEls = {};

  let driverId = null, myRole = null;
  let isDriver = false;
  let micMuted = false, deafMuted = false;

  const ROLE_LABEL = { blind:'أعمى 🙈', deaf:'أطرش 🙉', mute:'أخرس 🙊' };

  joinBtn.onclick = async () => {
    myName = nameInput.value.trim() || 'لاعب';
    room = roomInput.value.trim();
    if(!room){ alert('اكتب كود الأوضة الأول'); return; }
    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    await setupMic();
    connectSocket();
    setupThree();
    animate();
  };

  async function setupMic(){
    try{
      myStream = await navigator.mediaDevices.getUserMedia({audio:true});
    }catch(e){
      alert('محتاجين إذن المايك عشان تتكلم مع زمايلك!');
    }
  }

  function initPeer(){
    peer = new Peer();
    peer.on('open', (id)=>{
      socket.emit('join-room', { room, name: myName, peerId:id });
    });
    peer.on('call', (call)=>{
      call.answer(myStream);
      call.on('stream', (remoteStream)=> attachRemoteAudio(call.peer, remoteStream));
      remoteCalls[call.peer] = call;
    });
  }

  function callPeer(remoteSocketId, remotePeerId){
    if(!myStream || !peer) return;
    const call = peer.call(remotePeerId, myStream);
    call.on('stream', (remoteStream)=> attachRemoteAudio(remoteSocketId, remoteStream));
    remoteCalls[remoteSocketId] = call;
  }

  function attachRemoteAudio(socketId, stream){
    let el = remoteAudioEls[socketId];
    if(!el){
      el = document.createElement('audio');
      el.autoplay = true;
      audioHolder.appendChild(el);
      remoteAudioEls[socketId] = el;
    }
    el.srcObject = stream;
    el.muted = false;
  }

  function setDeafLocal(on){
    deafMuted = on;
    Object.values(remoteAudioEls).forEach(el => el.muted = on);
  }

  micIcon.onclick = ()=>{
    if(!myStream) return;
    micMuted = !micMuted;
    myStream.getAudioTracks().forEach(t=> t.enabled = !micMuted);
    micIcon.textContent = micMuted ? '🔇' : '🎤';
  };

  function connectSocket(){
    socket = io();
    socket.on('connect', ()=>{ myId = socket.id; initPeer(); });

    socket.on('existing-peers', (list)=>{
      list.forEach(p=>{
        if(p.peerId) callPeer(p.id, p.peerId);
      });
    });

    socket.on('players-update', (players)=>{
      playersList.innerHTML = Object.entries(players).map(([id,p])=>{
        const tag = id===driverId ? ' 🚗' : '';
        return `<span>${p.name}${tag}</span>`;
      }).join('');
    });

    socket.on('peer-joined', ()=>{});
    socket.on('peer-left', (id)=>{
      if(remoteCalls[id]){ remoteCalls[id].close(); delete remoteCalls[id]; }
      if(remoteAudioEls[id]){ remoteAudioEls[id].remove(); delete remoteAudioEls[id]; }
    });

    socket.on('driver-set', (data)=>{
      driverId = data.driverId; myRole = data.role;
      isDriver = (driverId === myId);
      updateRoleUI();
    });

    socket.on('car-update', (data)=>{
      if(!isDriver) applyRemoteCar(data);
    });

    socket.on('obstacle-spawn', (data)=> spawnObstacle(data));

    socket.on('game-over', (data)=>{
      finalScore.textContent = 'وصلتوا ' + data.score + ' متر مع بعض 💛';
      gameoverBox.classList.remove('hidden');
      driverId = null; myRole = null; isDriver = false;
      clearObstacles();
      updateRoleUI();
    });

    socket.on('reaction', (data)=> showFloatingEmoji(data.emoji));
  }

  driveBtn.onclick = ()=>{
    if(driverId) return;
    socket.emit('claim-driver');
  };

  document.querySelectorAll('.react-btn').forEach(btn=>{
    btn.onclick = ()=>{
      const e = btn.dataset.e;
      socket.emit('reaction', e);
      showFloatingEmoji(e);
    };
  });
  document.getElementById('closeGameOver').onclick = ()=> gameoverBox.classList.add('hidden');

  function showFloatingEmoji(e){
    const f = document.createElement('div');
    f.textContent = e;
    f.style.cssText = 'position:absolute; font-size:30px; pointer-events:none; z-index:20; left:'+(30+Math.random()*260)+'px; bottom:120px; transition:transform 1.4s ease-out, opacity 1.4s;';
    gameScreen.appendChild(f);
    requestAnimationFrame(()=>{ f.style.transform='translateY(-140px)'; f.style.opacity='0'; });
    setTimeout(()=> f.remove(), 1500);
  }

  function updateRoleUI(){
    if(!driverId){
      roleBanner.textContent = 'محدش بيسوق دلوقتي';
      driveBtn.classList.remove('hidden');
      blindOverlay.classList.remove('on');
      setDeafLocal(false);
      if(myStream) myStream.getAudioTracks().forEach(t=> t.enabled = true);
      return;
    }
    driveBtn.classList.add('hidden');
    if(isDriver){
      roleBanner.textContent = 'إنت السواق دلوقتي: ' + ROLE_LABEL[myRole];
      blindOverlay.classList.toggle('on', myRole==='blind');
      setDeafLocal(myRole==='deaf');
      if(myStream) myStream.getAudioTracks().forEach(t=> t.enabled = (myRole!=='mute'));
    } else {
      roleBanner.textContent = 'السواق دلوقتي: ' + ROLE_LABEL[myRole] + ' — ساعده!';
      blindOverlay.classList.remove('on');
      setDeafLocal(false);
      if(myStream) myStream.getAudioTracks().forEach(t=> t.enabled = !micMuted);
    }
  }

  let renderer, scene, camera, carMesh;
  let obstacles = [];
  let carX = 0, targetCarX = 0;
  let keyLeft=false, keyRight=false;
  let score = 0, lastScoreTick = 0, running = false;

  function setupThree(){
    const canvas = document.getElementById('scene');
    renderer = new THREE.WebGLRenderer({canvas, antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x0e1118);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0e1118, 20, 90);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 200);
    camera.position.set(0, 5, 9);
    camera.lookAt(0,0,-10);

    const amb = new THREE.AmbientLight(0xffffff, .6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, .8);
    dir.position.set(5,10,5);
    scene.add(dir);

    const roadGeo = new THREE.PlaneGeometry(10, 400);
    const roadMat = new THREE.MeshStandardMaterial({color:0x22262f});
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI/2;
    road.position.z = -180;
    scene.add(road);

    for(let i=0;i<40;i++){
      const lineGeo = new THREE.BoxGeometry(0.2, 0.05, 3);
      const lineMat = new THREE.MeshStandardMaterial({color:0xe8e3d5});
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.position.set(0, 0.03, -i*10);
      scene.add(line);
    }

    const carGeo = new THREE.BoxGeometry(1.6, 1, 3);
    const carMat = new THREE.MeshStandardMaterial({color:0xe8734a});
    carMesh = new THREE.Mesh(carGeo, carMat);
    carMesh.position.set(0, 0.5, 0);
    scene.add(carMesh);

    window.addEventListener('resize', ()=>{
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
    });

    window.addEventListener('keydown', e=>{
      if(e.key==='ArrowLeft') keyLeft=true;
      if(e.key==='ArrowRight') keyRight=true;
    });
    window.addEventListener('keyup', e=>{
      if(e.key==='ArrowLeft') keyLeft=false;
      if(e.key==='ArrowRight') keyRight=false;
    });

    running = true;
  }

  function spawnObstacle(data){
    const geo = new THREE.BoxGeometry(1.5, 1, 2.2);
    const mat = new THREE.MeshStandardMaterial({color:0x3a4152});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.lane, 0.5, -140);
    scene.add(mesh);
    obstacles.push({mesh, spawnedAt: performance.now()});
  }
  function clearObstacles(){
    obstacles.forEach(o=> scene.remove(o.mesh));
    obstacles = [];
    score = 0;
  }

  function applyRemoteCar(data){
    targetCarX = data.x;
  }

  let lastSend = 0;
  function animate(t){
    requestAnimationFrame(animate);
    if(!running) return;

    if(isDriver){
      if(keyLeft) targetCarX -= 0.12;
      if(keyRight) targetCarX += 0.12;
      targetCarX = Math.max(-3.5, Math.min(3.5, targetCarX));
      if(t - lastSend > 60){
        socket.emit('car-update', {x: targetCarX});
        lastSend = t;
      }
    }
    carX += (targetCarX - carX) * 0.18;
    carMesh.position.x = carX;
    camera.position.x = carX;
    camera.lookAt(carX, 0, -10);

    const speed = 0.55;
    obstacles.forEach(o=>{
      o.mesh.position.z += speed;
    });
    obstacles = obstacles.filter(o=>{
      if(o.mesh.position.z > 12){ scene.remove(o.mesh); return false; }
      return true;
    });

    if(isDriver){
      obstacles.forEach(o=>{
        const dx = Math.abs(o.mesh.position.x - carMesh.position.x);
        const dz = Math.abs(o.mesh.position.z - carMesh.position.z);
        if(dx < 1.4 && dz < 1.8){
          socket.emit('game-over', {score: Math.floor(score)});
          running = false;
          setTimeout(()=> running = true, 50);
        }
      });
      if(t - lastScoreTick > 200){ score += 1; lastScoreTick = t; }
    }

    renderer.render(scene, camera);
  }
})();
