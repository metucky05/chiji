/* hud.js — HUD：血条/弹药/存活数/毒圈计时、击杀播报、小地图、命中反馈、各结算屏 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  function $(id) { return document.getElementById(id); }

  var minimapBase = null; // 预烘焙地形底图
  var MM = 168;           // 小地图像素尺寸

  var Hud = {
    init: function () {
      this.elHealth = $("health-fill");
      this.elHealthNum = $("health-num");
      this.elAmmo = $("ammo");
      this.elWeapon = $("weapon-name");
      this.elAlive = $("alive-num");
      this.elKills = $("kill-num");
      this.elZone = $("zone-info");
      this.elFeed = $("killfeed");
      this.elToast = $("toast");
      this.elVignette = $("vignette");
      this.elHitmarker = $("hitmarker");
      this.elInteract = $("interact-tip");
      this.elDropTip = $("drop-tip");
      this.elScope = $("scope-overlay");
      this.elCrosshair = $("crosshair");
      this.elGun = $("gun-model");
      this.canvas = $("minimap");
      this.canvas.width = MM; this.canvas.height = MM;
      this.mmCtx = this.canvas.getContext("2d");
      this._toastTimer = null;
      this._mmTimer = 0;
    },

    show: function (show) { $("hud").style.display = show ? "block" : "none"; },

    bakeMinimap: function (world) {
      minimapBase = document.createElement("canvas");
      minimapBase.width = world.SIZE; minimapBase.height = world.SIZE;
      var g = minimapBase.getContext("2d");
      var colors = { 1: "#6aaa40", 2: "#866043", 3: "#7d7d7d", 4: "#665132", 5: "#3a7e22", 6: "#b28e5a", 7: "#dbcfa0", 8: "#94584c" };
      for (var x = 0; x < world.SIZE; x++) {
        for (var z = 0; z < world.SIZE; z++) {
          var info = world.topInfo(x, z);
          var c = colors[info.id] || "#444";
          // 高度明暗
          var shade = 0.65 + (info.y / world.HEIGHT) * 0.6;
          g.fillStyle = c;
          g.globalAlpha = Math.min(1, shade);
          g.fillRect(x, z, 1, 1);
        }
      }
      g.globalAlpha = 1;
    },

    update: function (dt) {
      var P = Chiji.Player, W = Chiji.Weapons.inventory, Z = Chiji.Zone, B = Chiji.Bots;
      // 血条
      var hp = Math.max(0, Math.round(P.health));
      this.elHealth.style.width = hp + "%";
      this.elHealth.style.background = hp > 50 ? "#4fc46a" : hp > 25 ? "#e8b73a" : "#d9442f";
      this.elHealthNum.textContent = hp;
      // 弹药
      if (W.weapon.id === "fist") this.elAmmo.textContent = "∞";
      else if (W.reloading > 0) this.elAmmo.textContent = "换弹中…";
      else this.elAmmo.textContent = W.magAmmo + " / " + W.reserve;
      this.elWeapon.textContent = W.weapon.icon + " " + W.weapon.name +
        (W.medkits > 0 ? "　🩹×" + W.medkits : "") + (W.blocks > 0 ? "　🧱×" + W.blocks : "");
      // 存活与击杀
      this.elAlive.textContent = B.aliveCount() + (P.alive ? 1 : 0);
      this.elKills.textContent = P.kills;
      // 毒圈
      var zs = Z.status();
      var t = Math.ceil(zs.timeLeft);
      this.elZone.textContent = zs.finished
        ? "决赛圈！"
        : (zs.shrinking ? "⚠ 毒圈收缩中 " + t + "s" : "第 " + zs.phase + " 圈 · " + t + "s 后收缩");
      this.elZone.className = zs.shrinking ? "warn" : "";
      // 圈外提示
      var outside = P.alive && !P.dropping && !Z.contains(P.pos);
      this.elVignette.style.opacity = outside ? 0.55 : (this._dmgFlash > 0 ? this._dmgFlash : 0);
      if (this._dmgFlash > 0) this._dmgFlash -= dt * 2;
      // 跳伞提示
      this.elDropTip.style.display = P.dropping ? "block" : "none";
      // 狙击开镜遮罩（其余枪开镜只放大不加遮罩）
      var scoped = P.zoomed && W.weapon.id === "sniper";
      this.elScope.style.display = scoped ? "block" : "none";
      // 跳伞阶段不显示准星；空手/跳伞时不显示枪模型
      this.elCrosshair.style.display = (scoped || P.dropping) ? "none" : "block";
      this.elGun.style.display = (W.weapon.id === "fist" || P.dropping || scoped) ? "none" : "block";
      // 小地图（10fps 足够）
      this._mmTimer -= dt;
      if (this._mmTimer <= 0) { this._mmTimer = 0.1; this.drawMinimap(); }
    },

    drawMinimap: function () {
      if (!minimapBase) return;
      var g = this.mmCtx, world = Chiji.World, Z = Chiji.Zone, P = Chiji.Player;
      var s = MM / world.SIZE;
      g.clearRect(0, 0, MM, MM);
      g.drawImage(minimapBase, 0, 0, MM, MM);
      // 下一圈（白）
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(Z.next.x * s, Z.next.z * s, Z.next.r * s, 0, Math.PI * 2);
      g.stroke();
      // 当前圈（蓝，收缩中变红）
      g.strokeStyle = Z.shrinking ? "rgba(255,90,58,0.95)" : "rgba(70,160,255,0.95)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(Z.current.x * s, Z.current.z * s, Z.current.r * s, 0, Math.PI * 2);
      g.stroke();
      // 空投标记（红点，落地前半透明）
      if (Chiji.Weapons.airdropMarkers) {
        var ads = Chiji.Weapons.airdropMarkers();
        for (var ai = 0; ai < ads.length; ai++) {
          var ad = ads[ai];
          g.fillStyle = ad.landed ? "#ff3b2a" : "rgba(255,120,60,0.85)";
          g.strokeStyle = "#fff";
          g.lineWidth = 1;
          g.beginPath();
          g.arc(ad.x * s, ad.z * s, 3, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      // 玩家箭头
      if (P.pos) {
        g.save();
        g.translate(P.pos.x * s, P.pos.z * s);
        g.rotate(-P.yaw);
        g.fillStyle = "#ffe93a";
        g.beginPath();
        g.moveTo(0, -5); g.lineTo(3.6, 4); g.lineTo(-3.6, 4);
        g.closePath(); g.fill();
        g.restore();
      }
    },

    // ---------- 反馈 ----------
    _dmgFlash: 0,
    flashDamage: function () { this._dmgFlash = 0.8; },
    hitmarker: function (lethal, headshot) {
      var el = this.elHitmarker;
      el.style.color = lethal ? "#ff4b3a" : (headshot ? "#ffd23a" : "#ffffff");
      el.style.opacity = 1;
      el.style.transform = "translate(-50%,-50%) scale(" + (lethal ? 1.5 : (headshot ? 1.3 : 1.1)) + ")";
      clearTimeout(this._hmT);
      this._hmT = setTimeout(function () {
        el.style.opacity = 0;
        el.style.transform = "translate(-50%,-50%) scale(1)";
      }, 120);
      if (Chiji.Audio) Chiji.Audio.hitmark();
    },
    recoil: function () {
      var el = $("gun-model");
      if (!el) return;
      el.style.transform = "translate(8px, 10px) rotate(4deg)";
      clearTimeout(this._rcT);
      this._rcT = setTimeout(function () { el.style.transform = "translate(0,0) rotate(0)"; }, 70);
    },

    killfeed: function (killer, victim) {
      var div = document.createElement("div");
      div.className = "feed-item";
      div.innerHTML = "<b>" + killer + "</b> ☠ " + victim;
      this.elFeed.appendChild(div);
      while (this.elFeed.children.length > 5) this.elFeed.removeChild(this.elFeed.firstChild);
      setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 6000);
    },

    toast: function (msg) {
      var el = this.elToast;
      el.textContent = msg;
      el.style.opacity = 1;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { el.style.opacity = 0; }, 1800);
    },

    interactTip: function (text) {
      this.elInteract.textContent = text || "";
      this.elInteract.style.display = text ? "block" : "none";
    },

    clearFeed: function () { this.elFeed.innerHTML = ""; },

    // ---------- 结算屏 ----------
    showMenu: function () { $("screen-menu").style.display = "flex"; },
    hideMenu: function () { $("screen-menu").style.display = "none"; },
    hideScreens: function () {
      $("screen-menu").style.display = "none";
      $("screen-death").style.display = "none";
      $("screen-win").style.display = "none";
      $("screen-pause").style.display = "none";
    },
    showDeath: function (rank, total, killer, kills) {
      $("death-rank").textContent = "#" + rank + " / " + total;
      $("death-info").textContent = "被 " + killer + " 淘汰 · 击杀 " + kills + " 人";
      $("screen-death").style.display = "flex";
    },
    showWin: function (kills) {
      $("win-info").textContent = "击杀 " + kills + " 人 · 排名 #1";
      $("screen-win").style.display = "flex";
    },
    showPause: function (show) { $("screen-pause").style.display = show ? "flex" : "none"; },
  };
  Chiji.Hud = Hud;
})();
