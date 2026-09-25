'use strict';

// Genie ("magic lamp") window opening effect: the window emerges from a dock
// icon. The deformation is the unminimize effect of
// compiz-alike-magic-lamp-effect by Mauro Pepe (GPL-3.0-or-later),
// https://github.com/hermes83/compiz-alike-magic-lamp-effect
// adapted to start from the icon itself (not the screen edge), with the side
// given by the dock position.

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const LAMP_EFFECT_NAME = 'd2da-lamp-open-effect';

export const LampOpenEffect = GObject.registerClass(
  { GTypeName: 'D2DALampOpenEffect' },
  class LampOpenEffect extends Clutter.DeformEffect {
    // params.icon: {x, y, width, height} of the dock icon, stage coordinates
    // params.side: St.Side of the screen the dock is on
    // params.effect, params.duration, params.xTiles, params.yTiles: as in
    // compiz-alike-magic-lamp-effect's settings
    _init(params = {}) {
      super._init();

      this.icon = { ...params.icon };
      this.iconPosition = params.side ?? St.Side.BOTTOM;
      this.EFFECT = params.effect ?? 'default';
      this.DURATION = params.duration ?? 400;
      this.X_TILES = params.xTiles ?? 10;
      this.Y_TILES = params.yTiles ?? 10;
      this.onDone = params.onDone ?? null;

      this.monitor = { x: 0, y: 0, width: 0, height: 0 };
      this.iconMonitor = null;
      this.window = { x: 0, y: 0, width: 0, height: 0 };

      // unminimize: starts fully collapsed into the icon
      this.progress = 0;
      this.split = 0.3;
      this.k = 1;
      this.j = 1;

      this.initialized = false;
    }

    vfunc_set_actor(actor) {
      super.vfunc_set_actor(actor);

      if (!this.actor || this.initialized) {
        return;
      }
      this.initialized = true;

      let monitorIndex = actor.meta_window
        ? actor.meta_window.get_monitor()
        : Main.layoutManager.primaryIndex;
      this.monitor = Main.layoutManager.monitors[monitorIndex];

      [this.window.x, this.window.y] = [
        this.actor.get_x() - this.monitor.x,
        this.actor.get_y() - this.monitor.y,
      ];
      [this.window.width, this.window.height] = actor.get_size();

      // the monitor the icon is on (the dock may be on another monitor)
      let icon = this.icon;
      this.iconMonitor =
        Main.layoutManager.monitors.find(
          (m) =>
            icon.x >= m.x &&
            icon.x <= m.x + m.width &&
            icon.y >= m.y &&
            icon.y <= m.y + m.height
        ) ?? this.monitor;
      let im = this.iconMonitor;

      // The genie math funnels the window into a strip reaching the screen
      // edge (as with a minimized window). Let that strip end at the icon's
      // inner side instead, so the window comes out of the icon itself.
      switch (this.iconPosition) {
        case St.Side.LEFT:
          icon.width = icon.x + icon.width - im.x;
          icon.x = im.x;
          break;
        case St.Side.RIGHT:
          icon.width = im.x + im.width - icon.x;
          break;
        case St.Side.TOP:
          icon.height = icon.y + icon.height - im.y;
          icon.y = im.y;
          break;
        case St.Side.BOTTOM:
        default:
          icon.height = im.y + im.height - icon.y;
          break;
      }

      // monitor relative, like the window
      icon.x -= this.monitor.x;
      icon.y -= this.monitor.y;

      this.set_n_tiles(this.X_TILES, this.Y_TILES);

      this.timeline = new Clutter.Timeline({
        actor: this.actor,
        duration:
          this.DURATION +
          (this.monitor.width * this.monitor.height) /
            Math.max(this.window.width * this.window.height, 1),
      });
      this.timeline.connectObject(
        'new-frame',
        this._onNewFrame.bind(this),
        'completed',
        this.destroy.bind(this),
        this
      );
      this.timeline.start();
    }

    _onNewFrame(timeline) {
      if (Main.overview.visible) {
        this.destroy();
        return;
      }

      this.progress = timeline.get_progress();
      let split = this.split;
      this.k =
        1 -
        (this.progress > 1 - split
          ? (this.progress - (1 - split)) * (1 / (1 - (1 - split)))
          : 0);
      this.j =
        1 -
        (this.progress <= 1 - split ? this.progress * (1 / (1 - split)) : 1);

      this.actor?.get_parent()?.queue_redraw();
      this.invalidate();
    }

    destroy() {
      let onDone = this.onDone;
      this.onDone = null;
      onDone?.();

      if (this.timeline) {
        this.timeline.disconnectObject(this);
        this.timeline.stop();
        this.timeline = null;
      }
      let actor = this.get_actor();
      if (actor) {
        actor.remove_effect(this);
      }
    }

    vfunc_modify_paint_volume(pv) {
      return false;
    }

    vfunc_deform_vertex(w, h, v) {
      if (!this.initialized) {
        return;
      }

      let window = this.window;
      let icon = this.icon;
      let iconMonitor = this.iconMonitor;
      let k = this.k;
      let j = this.j;

      let propX = w / window.width;
      let propY = h / window.height;

      let x = 0;
      let y = 0;
      let offsetX = 0;
      let offsetY = 0;
      let effectX = 0;
      let effectY = 0;

      if (this.iconPosition == St.Side.LEFT) {
        let width = window.width - icon.width + window.x * k;

        x = (width - j * width) * v.tx;
        y =
          (v.ty * window.height * (x + (width - x) * (1 - k))) / width +
          (v.ty * icon.height * (width - x)) / width;

        offsetX = icon.width - window.x * k;
        offsetY = (icon.y - window.y) * ((width - x) / width) * k;

        if (this.EFFECT === 'sine') {
          effectY =
            ((Math.sin((x / width) * Math.PI * 4) * window.height) / 14) * k;
        } else {
          effectY =
            ((Math.sin((0.5 - (width - x) / width) * 2 * Math.PI) *
              (window.y +
                window.height * v.ty -
                (icon.y + icon.height * v.ty))) /
              7) *
            k;
        }
      } else if (this.iconPosition == St.Side.TOP) {
        let height = window.height - icon.height + window.y * k;

        y = (height - j * height) * v.ty;
        x =
          (v.tx * window.width * (y + (height - y) * (1 - k))) / height +
          (v.tx * icon.width * (height - y)) / height;

        offsetX = (icon.x - window.x) * ((height - y) / height) * k;
        offsetY = icon.height - window.y * k;

        if (this.EFFECT === 'sine') {
          effectX =
            ((Math.sin((y / height) * Math.PI * 4) * window.width) / 14) * k;
        } else {
          effectX =
            ((Math.sin((0.5 - (height - y) / height) * 2 * Math.PI) *
              (window.x + window.width * v.tx - (icon.x + icon.width * v.tx))) /
              7) *
            k;
        }
      } else if (this.iconPosition == St.Side.RIGHT) {
        let expandWidth =
          iconMonitor.width - icon.width - window.x - window.width;
        let fullWidth =
          iconMonitor.width - icon.width - window.x - expandWidth * (1 - k);
        let width = fullWidth - j * fullWidth;

        x = v.tx * width;
        y =
          v.ty * icon.height +
          v.ty * (window.height - icon.height) * (1 - j) * (1 - v.tx) +
          v.ty * (window.height - icon.height) * (1 - k) * v.tx;

        offsetY =
          (icon.y - window.y) * (x / fullWidth) * k + (icon.y - window.y) * j;
        offsetX =
          iconMonitor.width -
          icon.width -
          window.x -
          width -
          expandWidth * (1 - k);

        if (this.EFFECT === 'sine') {
          effectY =
            ((Math.sin(((width - x) / fullWidth) * Math.PI * 4) *
              window.height) /
              14) *
            k;
        } else {
          effectY =
            ((Math.sin(((width - x) / fullWidth) * 2 * Math.PI + Math.PI) *
              (window.y +
                window.height * v.ty -
                (icon.y + icon.height * v.ty))) /
              7) *
            k;
        }
      } else {
        // BOTTOM
        let expandHeight =
          iconMonitor.height - icon.height - window.y - window.height;
        let fullHeight =
          iconMonitor.height - icon.height - window.y - expandHeight * (1 - k);
        let height = fullHeight - j * fullHeight;

        y = v.ty * height;
        x =
          v.tx * icon.width +
          v.tx * (window.width - icon.width) * (1 - j) * (1 - v.ty) +
          v.tx * (window.width - icon.width) * (1 - k) * v.ty;

        offsetX =
          (icon.x - window.x) * (y / fullHeight) * k + (icon.x - window.x) * j;
        offsetY =
          iconMonitor.height -
          icon.height -
          window.y -
          height -
          expandHeight * (1 - k);

        if (this.EFFECT === 'sine') {
          effectX =
            ((Math.sin(((height - y) / fullHeight) * Math.PI * 4) *
              window.width) /
              14) *
            k;
        } else {
          effectX =
            ((Math.sin(((height - y) / fullHeight) * 2 * Math.PI + Math.PI) *
              (window.x + window.width * v.tx - (icon.x + icon.width * v.tx))) /
              7) *
            k;
        }
      }

      v.x = (x + offsetX + effectX) * propX;
      v.y = (y + offsetY + effectY) * propY;
    }
  }
);
