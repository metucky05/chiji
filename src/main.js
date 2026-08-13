/* main.js — 引导：渲染器/场景/输入/状态机/主循环 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  var BOT_COUNT = 15;
  var renderer, scene, camera, clock;
  var state = "menu"; // menu | playing | dead | win
  var paused = false;
  var input = { f: false, b: false, l: false, r: false, jump: false, run: false, fire: false, zoom: false };
  var menuAngle = 0;
  var zoneDmgAcc = 0;
  var clouds = [];
  var totalPlayers = BOT_COUNT + 1;
  var KILL_HEAL = 15;

  function $(id) { return document.getElementById(id); }

  // ---------------- 初始化 ----------------
  function boot() {
    renderer = new THREE.WebGLRenderer({ antialias: false, canvas: $("game-canvas") });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8ec1ec);
    scene.fog = new THREE.Fog(0x8ec1ec, 60, 170);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

    var sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
    sun.position.set(60, 120, 30);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a8a4f, 0.75));

    var seed = (Math.random() * 1e9) | 0;
    Chiji.World.init(scene, seed);
    Chiji.Weapons.init(scene, Chiji.World);
    Chiji.Zone.init(scene, Chiji.World.SIZE);
    Chiji.Bots.init(scene, Chiji.World, BOT_COUNT);
    Chiji.Player.init(camera, Chiji.World);
    Chiji.Hud.init();
    Chiji.Hud.bakeMinimap(Chiji.World);
    spawnClouds();

    bindInput();
    clock = new THREE.Clock();
    Chiji.Hud.showMenu();
    requestAnimationFrame(loop);
  }

  function spawnClouds() {
    var mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (var i = 0; i < 14; i++) {
      var w = 8 + Math.random() * 18, d = 5 + Math.random() * 12;
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), mat);
      m.position.set(Math.random() * 220 - 40, 62 + Math.random() * 16, Math.random() * 220 - 40);
      scene.add(m);
      clouds.push(m);
    }
  }

  // ---------------- 输入 ----------------
  function bindInput() {
    var canvas = renderer.domElement;

    document.addEventListener("keydown", function (e) {
      if (e.code === "KeyW") input.f = true;
      if (e.code === "KeyS") input.b = true;
      if (e.code === "KeyA") input.l = true;
      if (e.code === "KeyD") input.r = true;
      if (e.code === "Space") { input.jump = true; e.preventDefault(); }
      if (e.code === "ShiftLeft") input.run = true;
      if (e.code === "KeyC") input.zoom = true;
      if (e.code === "KeyR") Chiji.Weapons.tryReload();
      if (e.code === "Digit4") Chiji.Weapons.useMedkit();
    });
    document.addEventListener("keyup", function (e) {
      if (e.code === "KeyW") input.f = false;
      if (e.code === "KeyS") input.b = false;
      if (e.code === "KeyA") input.l = false;
      if (e.code === "KeyD") input.r = false;
      if (e.code === "Space") input.jump = false;
      if (e.code === "ShiftLeft") input.run = false;
      if (e.code === "KeyC") input.zoom = false;
    });

    document.addEventListener("mousemove", function (e) {
      if (document.pointerLockElement !== canvas || state !== "playing") return;
      Chiji.Player.rotate(e.movementX, e.movementY);
    });
    document.addEventListener("mousedown", function (e) {
      if (state !== "playing" || document.pointerLockElement !== canvas) return;
      if (e.button === 0) { input.fire = true; doFire(); }
      if (e.button === 2) placeBlock();
    });
    document.addEventListener("mouseup", function (e) {
      if (e.button === 0) input.fire = false;
    });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    document.addEventListener("pointerlockchange", function () {
      if (document.pointerLockElement !== canvas && state === "playing") {
        paused = true; // 真暂停：主循环冻结战斗模拟
        Chiji.Hud.showPause(true);
      } else {
        paused = false;
        Chiji.Hud.showPause(false);
      }
    });

    $("btn-start").addEventListener("click", function () { startMatch(true); });
    $("btn-restart-dead").addEventListener("click", function () { startMatch(false); });
    $("btn-restart-win").addEventListener("click", function () { startMatch(false); });
    $("btn-resume").addEventListener("click", function () {
      lockPointer(canvas, 2);
    });
    window.addEventListener("resize", function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // Esc 退出指针锁后浏览器有 ~1.25s 冷却，期间 requestPointerLock 会被拒绝；
  // 失败时自动延迟重试，避免点"继续游戏"没反应
  function lockPointer(canvas, retries) {
    var p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(function () {
      if (retries > 0) setTimeout(function () { lockPointer(canvas, retries - 1); }, 1300);
    });
  }

  // firstTime=true 沿用菜单展示的地图；否则换新种子重新生成（无需刷新页面）
  function startMatch(firstTime) {
    Chiji.Audio.unlock();
    Chiji.Hud.hideScreens();
    Chiji.Hud.clearFeed();
    Chiji.Hud.show(true);
    if (!firstTime) {
      var seed = (Math.random() * 1e9) | 0;
      Chiji.World.init(scene, seed);
      Chiji.Hud.bakeMinimap(Chiji.World);
    }
    Chiji.Weapons.init(scene, Chiji.World);
    Chiji.Zone.init(scene, Chiji.World.SIZE);
    Chiji.Bots.init(scene, Chiji.World, BOT_COUNT);
    var S = Chiji.World.SIZE;
    Chiji.Player.startDrop(S * (0.25 + Math.random() * 0.5), S * (0.25 + Math.random() * 0.5));
    zoneDmgAcc = 0;
    paused = false;
    state = "playing";
    lockPointer(renderer.domElement, 2);
    Chiji.Hud.toast("空降中：WASD 漂移选择落点");
  }

  // ---------------- 战斗 ----------------
  function botTargets() {
    var arr = [];
    var list = Chiji.Bots.aliveBots();
    for (var i = 0; i < list.length; i++) arr.push(Chiji.Bots.botAABB(list[i]));
    return arr;
  }

  function doFire() {
    var P = Chiji.Player;
    if (!P.alive || P.dropping) return;
    var hits = Chiji.Weapons.playerFire(botTargets());
    if (!hits) return;
    var w = Chiji.Weapons.inventory.weapon;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.type === "bot") {
        // 命中点落在 AABB 顶部 0.5m 内视为爆头（机器人头高 0.5）
        var isHead = !!h.point && h.point.y > h.target.max.y - 0.5;
        var dmg = Math.round(w.dmg * (isHead ? 1.75 : 1));
        var killed = Chiji.Bots.damageBot(h.target.ref, dmg, null, "你");
        Chiji.Hud.hitmarker(killed, isHead);
        if (isHead) Chiji.Audio.headshot();
        if (killed) {
          P.kills++;
          P.health = Math.min(100, P.health + KILL_HEAL);
          Chiji.Hud.toast("击杀回复 +" + KILL_HEAL);
          Chiji.Audio.kill();
        }
      }
    }
  }

  function placeBlock() {
    var P = Chiji.Player, W = Chiji.World, inv = Chiji.Weapons.inventory;
    if (!P.alive || P.dropping) return;
    if (inv.blocks <= 0) { Chiji.Hud.toast("没有方块，拾取紫色箱子获得"); return; }
    var hit = W.raycastVoxel(P.eyePos(), P.lookDir(), 5);
    if (!hit.hit) return;
    var x = hit.x + hit.normal.x, y = hit.y + hit.normal.y, z = hit.z + hit.normal.z;
    // 不允许把方块放进自己/机器人身体里
    if (overlapsEntity(x, y, z)) return;
    if (W.getBlock(x, y, z) !== W.BLOCK.AIR) return;
    if (W.setBlock(x, y, z, W.BLOCK.PLANK)) {
      inv.blocks--;
      Chiji.Audio.place();
    }
  }

  function overlapsEntity(bx, by, bz) {
    function hitBody(pos, hw, hh) {
      return bx + 1 > pos.x - hw && bx < pos.x + hw &&
        bz + 1 > pos.z - hw && bz < pos.z + hw &&
        by + 1 > pos.y && by < pos.y + hh * 2;
    }
    if (hitBody(Chiji.Player.pos, 0.32, 0.9)) return true;
    var list = Chiji.Bots.aliveBots();
    for (var i = 0; i < list.length; i++) if (hitBody(list[i].pos, 0.3, 0.9)) return true;
    return false;
  }

  // ---------------- 事件回调（由其他模块触发） ----------------
  Chiji.Main = {
    onBotDeath: function (bot, killerName) {
      Chiji.Hud.killfeed(killerName, bot.name);
    },
    onPlayerDeath: function (killerName) {
      if (state !== "playing") return;
      state = "dead";
      var rank = Chiji.Bots.aliveCount() + 1;
      Chiji.Audio.death();
      document.exitPointerLock();
      Chiji.Hud.showDeath(rank, totalPlayers, killerName, Chiji.Player.kills);
    },
  };

  function checkWin() {
    if (state !== "playing") return;
    if (Chiji.Player.alive && Chiji.Bots.aliveCount() === 0) {
      state = "win";
      Chiji.Audio.win();
      document.exitPointerLock();
      Chiji.Hud.showWin(Chiji.Player.kills);
      Chiji.Hud.killfeed("大吉大利", "今晚吃鸡");
    }
  }

  // ---------------- 主循环 ----------------
  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, clock.getDelta());
    var t = clock.elapsedTime;

    // 云漂移
    for (var i = 0; i < clouds.length; i++) {
      clouds[i].position.x += dt * 1.2;
      if (clouds[i].position.x > 200) clouds[i].position.x = -60;
    }

    // 真暂停：冻结整场战斗，仅保留画面渲染
    if (state === "playing" && paused) {
      renderer.render(scene, camera);
      return;
    }

    if (state === "menu") {
      menuAngle += dt * 0.08;
      var S = Chiji.World.SIZE / 2;
      camera.position.set(S + Math.cos(menuAngle) * 70, 58, S + Math.sin(menuAngle) * 70);
      camera.lookAt(S, 12, S);
      Chiji.Bots.update(dt, { peace: true }); // 菜单只做空降展示，不互殴
      Chiji.Weapons.update(dt, t, new THREE.Vector3(-99, -99, -99), false);
    } else {
      var P = Chiji.Player;
      P.update(dt, input);
      Chiji.Zone.update(dt);
      Chiji.Bots.update(dt, {});
      Chiji.Weapons.update(dt, t, P.pos, P.alive && !P.dropping);

      // 连发武器按住扫射
      if (input.fire && Chiji.Weapons.inventory.weapon.auto) doFire();

      // 毒圈伤害（积攒后整数扣除，避免每帧音效轰炸）
      if (P.alive && !P.dropping && !Chiji.Zone.contains(P.pos)) {
        zoneDmgAcc += Chiji.Zone.damagePerSec() * dt;
        if (zoneDmgAcc >= 2) {
          P.takeDamage(Math.floor(zoneDmgAcc), null, "毒圈");
          zoneDmgAcc -= Math.floor(zoneDmgAcc);
        }
      }

      if (state !== "menu") Chiji.Hud.update(dt);
      checkWin();
    }

    renderer.render(scene, camera);
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
