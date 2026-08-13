/* zone.js — 缩圈机制：蓝色能量墙可视化，分阶段收缩与圈外伤害 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  // 各阶段：等待时长 / 收缩时长 / 目标半径比例 / 圈外每秒伤害
  // 第一阶段给足搜物资时间（35→45s），避免刚捡两个箱子就被迫跑毒
  var PHASES = [
    { wait: 45, shrink: 25, ratio: 0.62, dps: 1.5 },
    { wait: 25, shrink: 22, ratio: 0.55, dps: 3 },
    { wait: 20, shrink: 18, ratio: 0.5, dps: 6 },
    { wait: 15, shrink: 15, ratio: 0.45, dps: 10 },
    { wait: 12, shrink: 12, ratio: 0.4, dps: 16 },
    { wait: 10, shrink: 10, ratio: 0.01, dps: 24 },
  ];

  var Zone = {
    current: { x: 0, z: 0, r: 0 },   // 当前安全区
    next: { x: 0, z: 0, r: 0 },      // 下一安全区
    phaseIdx: 0,
    timer: 0,
    shrinking: false,
    finished: false,
    wallMesh: null,
    scene: null,

    init: function (scene, mapSize) {
      this.scene = scene;
      this.mapSize = mapSize;
      if (this.wallMesh) scene.remove(this.wallMesh);
      var half = mapSize / 2;
      this.current = { x: half, z: half, r: half * 1.05 };
      this.phaseIdx = 0;
      this.timer = PHASES[0].wait;
      this.shrinking = false;
      this.finished = false;
      this.pickNext();

      var geo = new THREE.CylinderGeometry(1, 1, 90, 64, 1, true);
      var mat = new THREE.MeshBasicMaterial({
        color: 0x3aa0ff, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      });
      this.wallMesh = new THREE.Mesh(geo, mat);
      this.wallMesh.position.set(this.current.x, 30, this.current.z);
      scene.add(this.wallMesh);
      this.syncWall();
    },

    pickNext: function () {
      var p = PHASES[this.phaseIdx];
      var c = this.current;
      var nr = c.r * p.ratio;
      var maxOff = c.r - nr;
      var ang = Math.random() * Math.PI * 2;
      var off = Math.random() * maxOff * 0.85;
      this.next = { x: c.x + Math.cos(ang) * off, z: c.z + Math.sin(ang) * off, r: nr };
      this._from = { x: c.x, z: c.z, r: c.r };
    },

    update: function (dt) {
      if (this.finished) return;
      var p = PHASES[this.phaseIdx];
      this.timer -= dt;

      if (!this.shrinking) {
        if (this.timer <= 0) {
          this.shrinking = true;
          this.timer = p.shrink;
          if (Chiji.Hud) Chiji.Hud.toast("毒圈开始收缩！");
          if (Chiji.Audio) Chiji.Audio.zoneWarn();
        }
      } else {
        var t = Math.max(0, Math.min(1, 1 - this.timer / p.shrink));
        var f = this._from, n = this.next;
        this.current.x = f.x + (n.x - f.x) * t;
        this.current.z = f.z + (n.z - f.z) * t;
        this.current.r = f.r + (n.r - f.r) * t;
        if (this.timer <= 0) {
          this.current = { x: n.x, z: n.z, r: n.r };
          this.shrinking = false;
          this.phaseIdx++;
          if (this.phaseIdx >= PHASES.length) {
            this.finished = true;
            this.current.r = 0.5;
          } else {
            this.timer = PHASES[this.phaseIdx].wait;
            this.pickNext();
            // 进入第 2、4 圈时在下一安全区内投放空投，制造争夺点
            if ((this.phaseIdx === 1 || this.phaseIdx === 3) && Chiji.Weapons && Chiji.Weapons.spawnAirdrop) {
              var aa = Math.random() * Math.PI * 2;
              var ar = Math.random() * this.next.r * 0.7;
              var lim = this.mapSize - 6;
              var ax = Math.max(6, Math.min(lim, this.next.x + Math.cos(aa) * ar));
              var az = Math.max(6, Math.min(lim, this.next.z + Math.sin(aa) * ar));
              Chiji.Weapons.spawnAirdrop(ax, az);
            }
          }
        }
      }
      this.syncWall();
    },

    syncWall: function () {
      if (!this.wallMesh) return;
      this.wallMesh.position.x = this.current.x;
      this.wallMesh.position.z = this.current.z;
      var r = Math.max(0.5, this.current.r);
      this.wallMesh.scale.set(r, 1, r);
      // 收缩时墙体提示变红
      this.wallMesh.material.color.setHex(this.shrinking ? 0xff5a3a : 0x3aa0ff);
      this.wallMesh.material.opacity = this.shrinking ? 0.3 : 0.2;
    },

    contains: function (pos) {
      var dx = pos.x - this.current.x, dz = pos.z - this.current.z;
      return dx * dx + dz * dz <= this.current.r * this.current.r;
    },

    damagePerSec: function () {
      var i = Math.min(this.phaseIdx, PHASES.length - 1);
      return PHASES[i].dps;
    },

    // HUD 显示信息
    status: function () {
      return {
        phase: this.phaseIdx + 1,
        total: PHASES.length,
        shrinking: this.shrinking,
        timeLeft: Math.max(0, this.timer),
        finished: this.finished,
      };
    },
  };
  Chiji.Zone = Zone;
})();
