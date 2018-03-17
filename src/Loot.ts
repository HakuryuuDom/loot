import * as Command from "command";
import * as path from "path";
import * as fs from "fs";

const DEFAULT_CONFIG = {
  enabled: {
    overworld: false,
    instance: true
  },
  lootRange: 150,
  lootInterval: 300,
  template: "default",
  templates: {
    default: {
      whitelist: [],
      blacklist: []
    }
  }
};

const filter = (arr: DropItem[], id: any) =>
  arr.filter(a => a.id.toString() !== id.toString());

export class Loot {
  hooks: Hook[];
  records: any[] = [];
  command: any;

  gameId: any;
  zone: number;
  isMounted: boolean;
  isDead: boolean;

  config: Configuration;
  template: { whitelist: number[]; blacklist: number[] };

  drops: DropItem[];
  position: { x: number; y: number; z: number };

  lootTimer: any;

  constructor(public dispatch: any) {
    this.command = Command(this.dispatch);
    this.position = { x: 0, y: 0, z: 0 };
    this.drops = [];

    if (!fs.existsSync(path.join(__dirname, "config.json")))
      this.generateConfig();
    this.loadConfig();

    this.hooks = [
      {
        packet: ["S_LOGIN", 9],
        callback: _ => {
          this.gameId = _.gameId;
          this.template = this.config
            ? this.config.templates[this.config.template]
            : DEFAULT_CONFIG.templates[DEFAULT_CONFIG.template];
        }
      },
      {
        packet: ["C_PLAYER_LOCATION", 3],
        callback: _ => Object.assign(this.position, _.loc)
      },
      {
        packet: ["S_SPAWN_DROPITEM", 6],
        callback: _ => this.handleItemDrops(_)
      },
      {
        packet: ["S_DESPAWN_DROPITEM", 4],
        callback: _ => {
          this.drops = filter(this.drops, _.gameId.toString());
        }
      },
      {
        packet: ["S_LOAD_TOPO", 3],
        callback: _ => {
          this.zone = _.zone;
          Object.assign(this.position, _.loc);
          this.drops = [];
        }
      },
      {
        packet: ["S_MOUNT_VEHICLE", 2],
        callback: _ => {
          if (this.gameId.toString() === _.gameId.toString())
            this.isMounted = true;
        }
      },
      {
        packet: ["S_UNMOUNT_VEHICLE", 2],
        callback: _ => {
          if (this.gameId.toString() === _.gameId.toString())
            this.isMounted = false;
        }
      },
      {
        packet: ["S_CREATURE_LIFE", 2],
        callback: _ => {
          if (this.gameId.toString() === _.gameId.toString())
            this.isDead = !_.alive;
        }
      },
      {
        packet: ["S_SPAWN_ME", 2],
        callback: _ => {
          Object.assign(this.position, _.loc);
          this.isDead = !_.alive;
        }
      }
    ];

    this.command.add("loot", (...args: string[]) => {
      if (args.length < 1) {
        this.config.enabled.overworld = !this.config.enabled.overworld;
        this.config.enabled.instance = !this.config.enabled.instance;
        this.command.message(
          "[Loot] Loot in overworld: " +
            this.config.enabled.overworld +
            " | Loot in instances: " +
            this.config.enabled.instance
        );
      } else {
        switch (args[0]) {
          case "overworld":
            this.config.enabled.overworld = !this.config.enabled.overworld;
            this.command.message(
              "[Loot] Loot in overworld: " + this.config.enabled.overworld
            );
            break;
          case "instance":
            this.config.enabled.instance = !this.config.enabled.instance;
            this.command.message(
              "[Loot] Loot in instances: " + this.config.enabled.instance
            );
            break;
          case "templates":
            this.command.message(
              "[Loot] Available templates: " +
                Object.keys(this.config.templates).toString()
            );
            break;
          case "set":
          case "use":
            if (args.length < 2) {
              this.command.message("[Loot] Please define a template to use.");
              break;
            }
            if (!(args[1] in this.config.templates)) {
              this.command.message(
                "[Loot] Cannot find template: " + args[1] + " in configuration."
              );
              break;
            }
            this.config.template = args[1];
            this.template = this.config.templates[args[1]];
            this.command.message(
              "[Loot] Active loot template set to: " + args[1]
            );
            break;
          case "save":
            this.saveConfig();
            break;
          case "load":
            this.loadConfig();
            break;
          default:
            this.command.message(
              "[Loot] Commands: overworld, instance, templates, save, load"
            );
            break;
        }
      }
    });

    this.load();
  }

  load(): void {
    if (this.hooks && this.hooks.length > 0)
      this.hooks.forEach(h => {
        this.records.push(
          this.dispatch.hook(h.packet[0], h.packet[1], h.callback)
        );
      });
  }

  unload(): void {
    if (this.records && this.records.length > 0)
      this.records.forEach(r => {
        this.dispatch.unhook(r);
      });
  }

  generateConfig(): void {
    let data = fs.readFileSync(path.join(__dirname, "config.json"));
    if (!data)
      fs.writeFileSync(
        path.join(__dirname, "config.json"),
        JSON.stringify(DEFAULT_CONFIG, null, 2)
      );
  }

  loadConfig(): void {
    try {
      this.config = JSON.parse(
        fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")
      ) as Configuration;
    } catch (err) {
      this.config = DEFAULT_CONFIG;
      console.error(err);
    }
  }

  saveConfig(): void {
    fs.writeFileSync(
      path.join(__dirname, "config.json"),
      JSON.stringify(this.config ? this.config : DEFAULT_CONFIG, null, 2)
    );
  }

  loot(): void {
    if (this.lootTimer) {
      clearTimeout(this.lootTimer);
      this.lootTimer = null;
    }

    if (!this.drops.length) return;

    for (let item of this.drops)
      if (this.isInRange(item, this.config.lootRange)) {
        this.dispatch.toServer("C_TRY_LOOT_DROPITEM", 1, { id: item.id });
      }

    this.lootTimer = setTimeout(this.loot.bind(this), this.config.lootInterval);
  }

  handleItemDrops(_: any): void {
    if (this.config && this.config.enabled && this.template) {
      if (this.zone && this.zone < 9000 && !this.config.enabled.overworld)
        return;
      if (this.zone && this.zone >= 9000 && !this.config.enabled.instance)
        return;
      if (this.template.whitelist.length > 0) {
        // Ignore blacklist and any other item.
        if (!this.template.whitelist.includes(_.item)) return;
        this.drops.push({ id: _.gameId, item: _.item, position: _.loc });
      } else if (this.template.blacklist.length > 0) {
        // Ignore specified items.
        if (this.template.blacklist.includes(_.item)) return;
        this.drops.push({ id: _.gameId, item: _.item, position: _.loc });
      } else {
        // Let all drops in.
        this.drops.push({ id: _.gameId, item: _.item, position: _.loc });
      }

      this.lootTimer = setTimeout(
        this.loot.bind(this),
        this.config.lootInterval
      );
    }
  }

  tryLootItem(item: DropItem): void {
    if (
      this.isInRange(
        item,
        this.config.lootRange > 150 ? 150 : this.config.lootRange
      ) &&
      !this.isMounted &&
      !this.isDead
    )
      this.dispatch.toServer("C_TRY_LOOT_DROPITEM", 4, {
        gameId: item.id
      });
  }

  isInRange(item: DropItem, units: number): boolean {
    return (
      Math.sqrt(
        Math.pow(item.position.x - this.position.x, 2) +
          Math.pow(item.position.y - this.position.y, 2) +
          Math.pow(item.position.z - this.position.z, 2)
      ) <= units
    );
  }
}

export interface Hook {
  packet: (string | number)[];
  callback: (event: any) => boolean | void;
}

export interface DropItem {
  id: any;
  item: number;
  position: { x: number; y: number; z: number };
}

export interface Configuration {
  enabled: { overworld: boolean; instance: boolean };
  lootRange: number;
  lootInterval: number;
  template: string;
  templates: { [key: string]: { whitelist: number[]; blacklist: number[] } };
}