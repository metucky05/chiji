/* audio.js — WebAudio 程序化音效（无外部资源） */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});
  var ctx = null, master = null;
  var volScale = 1; // 距离衰减用，burst/noiseBurst 调度时读取

  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return true;
  }
  function now() { return ctx.currentTime; }

  function noiseBuffer(len) {
    var buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(dur, freq, type, gain, slideTo) {
    if (!ensure()) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, now());
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now() + dur);
    g.gain.setValueAtTime(gain * volScale, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(now() + dur);
  }

  function noiseBurst(dur, gain, filterFreq) {
    if (!ensure()) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    var f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = filterFreq || 2000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain * volScale, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  Chiji.Audio = {
    unlock: function () { ensure(); if (ctx && ctx.state === "suspended") ctx.resume(); },
    shot: function (wid) {
      if (wid === "fist") { noiseBurst(0.08, 0.25, 900); return; }
      if (wid === "shotgun") { noiseBurst(0.28, 0.9, 1200); burst(0.12, 120, "square", 0.5, 50); }
      else if (wid === "sniper") { noiseBurst(0.35, 0.8, 2500); burst(0.25, 180, "sawtooth", 0.4, 40); }
      else { noiseBurst(0.12, 0.6, 2200); burst(0.08, 220, "square", 0.3, 70); }
    },
    // 远处枪声按距离衰减（volScale 在同步调度内生效，不影响已播放声音）
    shotAt: function (wid, pos) {
      if (!ensure() || !Chiji.Player.pos) return;
      var d = Chiji.Player.pos.distanceTo(pos);
      var vol = Math.max(0, 1 - d / 80);
      if (vol <= 0.02) return;
      volScale = vol;
      this.shot(wid);
      volScale = 1;
    },
    hitmark: function () { burst(0.06, 1100, "square", 0.25, 800); },
    headshot: function () { burst(0.08, 1400, "square", 0.28, 1900); },
    empty: function () { burst(0.05, 1500, "square", 0.12, 1100); },
    hurt: function () { burst(0.15, 200, "sawtooth", 0.3, 90); },
    blockBreak: function () { noiseBurst(0.12, 0.3, 700); },
    place: function () { burst(0.07, 320, "square", 0.2, 240); },
    pickup: function () { burst(0.07, 660, "square", 0.22, 990); burst(0.1, 880, "square", 0.18, 1320); },
    heal: function () { burst(0.25, 440, "sine", 0.25, 880); },
    reload: function () { burst(0.06, 500, "square", 0.15, 300); setTimeout(function () { burst(0.06, 700, "square", 0.15, 900); }, 350); },
    zoneWarn: function () { burst(0.5, 520, "sine", 0.3, 520); setTimeout(function () { burst(0.5, 520, "sine", 0.3, 520); }, 600); },
    chute: function () { noiseBurst(0.5, 0.25, 500); },
    land: function () { noiseBurst(0.15, 0.35, 600); },
    kill: function () { burst(0.09, 700, "square", 0.3, 1050); setTimeout(function () { burst(0.12, 1050, "square", 0.3, 1400); }, 90); },
    death: function () { burst(0.8, 300, "sawtooth", 0.35, 60); },
    win: function () {
      var seq = [523, 659, 784, 1046];
      for (var i = 0; i < seq.length; i++) {
        (function (f, t) { setTimeout(function () { burst(0.3, f, "square", 0.3); }, t); })(seq[i], i * 180);
      }
    },
  };
})();
