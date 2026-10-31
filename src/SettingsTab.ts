import { App, PluginSettingTab, Setting } from "obsidian";
import type BardPlayerPlugin from "./main";
import { MiniBackdrop } from "./settings";

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

		new Setting(containerEl).setName("Mini player").setHeading();

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
	}
}
