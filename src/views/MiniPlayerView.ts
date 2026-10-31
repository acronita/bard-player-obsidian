import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_MINI } from "../constants";
import type BardPlayerPlugin from "../main";
import { MiniControls } from "./MiniControls";

/** Compact player meant to be docked (sidebar, corner split, pinned tab or popout). */
export class MiniPlayerView extends ItemView {
	private controls: MiniControls | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: BardPlayerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MINI;
	}

	getDisplayText(): string {
		return "Mini player";
	}

	getIcon(): string {
		return "headphones";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("bard-mini-view");
		this.controls = new MiniControls(this.contentEl, this.plugin.getPlayer(), () => void this.plugin.activatePlayerView());
	}

	async onClose(): Promise<void> {
		this.controls?.destroy();
		this.controls = null;
	}
}
