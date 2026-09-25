'use strict';

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LampOpenEffect, LAMP_EFFECT_NAME } from './effects/lamp_effect.js';

const COMPIZ_UUID = 'compiz-alike-magic-lamp-effect@hermes83.github.com';
const BMS_BLUR_ACTOR = 'bms-application-blurred-widget';

// a launched app has this long (msecs) to show its first window
const LAUNCH_TIMEOUT = 15000;

const LAMP_WINDOW_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
];

// macOS-like app launch: the dock icon jumps up and waits there until the
// app's first window opens, which then comes out of the icon like a genie
// from a lamp (matching compiz-alike-magic-lamp-effect's minimize, whose
// settings are used when it is enabled)
export const LampLauncher = class {
  constructor(extension) {
    this.extension = extension;
    // app id => launch time (msecs)
    this._pending = new Map();
  }

  enable() {
    // connected after GNOME Shell's own 'map' handler, so its animation has
    // already started when we replace it
    global.window_manager.connectObject(
      'map',
      (_wm, actor) => this._onMap(actor),
      this
    );
    Shell.AppSystem.get_default().connectObject(
      'app-state-changed',
      (_appSystem, app) => this._onAppStateChanged(app),
      this
    );
  }

  disable() {
    global.window_manager.disconnectObject(this);
    Shell.AppSystem.get_default().disconnectObject(this);

    for (let appId of this._pending.keys()) {
      this._dropIcons(appId);
    }
    this._pending.clear();

    global.get_window_actors().forEach((actor) => {
      actor.get_effect(LAMP_EFFECT_NAME)?.destroy();
    });
  }

  get enabled() {
    return this.extension.lamp_open_animation;
  }

  // `app` is being launched: lift its dock icons until a window opens
  expect(app) {
    if (!this.enabled || !app) return;
    let appId = app.get_id();
    this._pending.set(appId, GLib.get_monotonic_time() / 1000);
    this._liftIcons(appId);
  }

  _onAppStateChanged(app) {
    if (!this.enabled) return;
    switch (app.state) {
      case Shell.AppState.STARTING:
        // launched from anywhere (dock, app grid, search...)
        this.expect(app);
        break;
      case Shell.AppState.STOPPED:
        // the launch failed or the app quit before showing a window
        if (this._pending.delete(app.get_id())) {
          this._dropIcons(app.get_id());
        }
        break;
    }
  }

  _onMap(actor) {
    let win = actor?.meta_window;
    if (!win || !LAMP_WINDOW_TYPES.includes(win.get_window_type())) return;

    let app = Shell.WindowTracker.get_default().get_window_app(win);
    let appId = app?.get_id();
    if (!appId || !this._pending.has(appId)) return;

    let launched = this._pending.get(appId);
    this._pending.delete(appId);
    this._dropIcons(appId);

    let now = GLib.get_monotonic_time() / 1000;
    if (!this.enabled || now - launched > LAUNCH_TIMEOUT) return;
    if (Main.overview.visible) return;

    let target = this._findIcon(appId, win.get_monitor());
    if (!target) return;

    // Replace GNOME Shell's map animation (scale + fade). Stopping its
    // transitions runs its completion, which finishes the map right away;
    // ours is purely visual.
    actor.remove_all_transitions();
    actor.set_pivot_point(0, 0);
    actor.set_scale(1, 1);
    actor.set_translation(0, 0, 0);
    actor.opacity = 255;

    actor.get_effect(LAMP_EFFECT_NAME)?.destroy();

    // The deformation renders the window offscreen, where a background blur
    // (Blur my Shell's application blur) has nothing behind it: it would show
    // nothing, yet cost a full blur every frame. Hide it meanwhile.
    let blur = actor
      .get_children()
      .find((c) => c.name === BMS_BLUR_ACTOR && c.visible);
    blur?.hide();

    actor.add_effect_with_name(
      LAMP_EFFECT_NAME,
      new LampOpenEffect({
        icon: target.rect,
        side: target.side,
        ...this._compizSettings(),
        onDone: () => {
          if (blur && blur.get_parent() === actor) blur.show();
        },
      })
    );
  }

  // the look of compiz-alike-magic-lamp-effect, when it is enabled
  _compizSettings() {
    let settings =
      Main.extensionManager.lookup(COMPIZ_UUID)?.stateObj?.settingsData;
    if (!settings) return {};
    try {
      return {
        effect: settings.EFFECT.get(),
        duration: settings.DURATION.get(),
        xTiles: settings.X_TILES.get(),
        yTiles: settings.Y_TILES.get(),
      };
    } catch (err) {
      return {};
    }
  }

  _iconsOf(appId) {
    let icons = [];
    (this.extension.docks ?? []).forEach((dock) => {
      let icon = dock
        ._findIcons()
        .find((icon) => icon._appwell && icon._appwell._id == appId);
      if (icon) icons.push({ dock, icon });
    });
    return icons;
  }

  _liftIcons(appId) {
    this._iconsOf(appId).forEach(({ dock, icon }) => {
      dock.animator.liftIcon(icon._appwell);
    });
  }

  _dropIcons(appId) {
    this._iconsOf(appId).forEach(({ dock }) => {
      dock.animator.dropIcon(appId);
    });
  }

  // the rect (stage coordinates) of the app's visible dock icon, preferring
  // the dock on the window's monitor, and the side of the screen it is on
  _findIcon(appId, monitorIndex) {
    let icons = this._iconsOf(appId);
    let found =
      icons.find(({ dock }) => dock._monitorIndex == monitorIndex) ?? icons[0];
    if (!found) return null;

    let { dock, icon } = found;
    let actor = icon._renderer ?? icon;
    let [x, y] = actor.get_transformed_position();
    let [width, height] = actor.get_transformed_size();
    if (!width || !height) return null;

    let side =
      {
        left: St.Side.LEFT,
        right: St.Side.RIGHT,
        top: St.Side.TOP,
        bottom: St.Side.BOTTOM,
      }[dock._position] ?? St.Side.BOTTOM;

    return { rect: { x, y, width, height }, side };
  }
};
