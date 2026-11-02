import { App, PluginSettingTab, Setting } from "obsidian";
import type BardPlayerPlugin from "./main";
import { MiniBackdrop, StartupPlayback } from "./settings";

const STARTUP_LABELS: Record<StartupPlayback, string> = {
	off: "Do nothing",
	resume: "Resume where it stopped",
	restart: "Play from the beginning",
};

const BACKDROP_LABELS: Record<MiniBackdrop, string> = {
	artwork: "Blurred artwork",
	theme: "Theme background",
	black: "Black",
};

export class BardSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BardPlayerPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Playback").setHeading();

		new Setting(containerEl)
			.setName("On startup")
			.setDesc("When Obsidian opens, play the last track, playlist or radio again.")
			.addDropdown((d) =>
				d
					.addOptions(STARTUP_LABELS)
					.setValue(settings.startupPlayback)
					.onChange((value) => void this.plugin.updateSettings({ startupPlayback: value as StartupPlayback })),
			);

		new Setting(containerEl).setName("Mini player").setHeading();

		new Setting(containerEl)
			.setName("Ribbon button")
			.setDesc("Show a button in the left ribbon that opens the mini player.")
			.addToggle((t) =>
				t
					.setValue(settings.miniRibbonIcon)
					.onChange((value) => void this.plugin.updateSettings({ miniRibbonIcon: value })),
			);

		new Setting(containerEl)
			.setName("Background")
			.setDesc("What sits behind the mini player controls.")
			.addDropdown((d) =>
				d
					.addOptions(BACKDROP_LABELS)
					.setValue(settings.miniBackdrop)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ miniBackdrop: value as MiniBackdrop });
						this.display();
					}),
			);

		if (settings.miniBackdrop === "artwork") {
			new Setting(containerEl)
				.setName("Artwork intensity")
				.setDesc("How strongly the blurred cover shows through.")
				.addSlider((s) =>
					s
						.setLimits(0, 100, 5)
						.setValue(settings.miniArtworkOpacity)
						.setDynamicTooltip()
						.onChange((value) => void this.plugin.updateSettings({ miniArtworkOpacity: value })),
				);
		}

		new Setting(containerEl).setName("Troubleshooting").setHeading();

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Write sign-in diagnostics to the developer console (Ctrl+Shift+I, Console tab). Turn it on, reproduce the problem, then copy the lines starting with [bard-player].")
			.addToggle((t) =>
				t
					.setValue(settings.debugLogging)
					.onChange((value) => void this.plugin.updateSettings({ debugLogging: value })),
			);
	}
}
