import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { hexToInt } from "../render/theme.js";

/**
 * Tous les messages du bot utilisent exclusivement les Components V2.
 * Le flag IsComponentsV2 interdit `content` et `embeds` : on ne renvoie
 * donc jamais d'embed classique.
 */
export const V2_FLAGS = MessageFlags.IsComponentsV2;

export function text(md: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(md);
}

export function separator(large = false, divider = true): SeparatorBuilder {
  return new SeparatorBuilder()
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small)
    .setDivider(divider);
}

export function imageGallery(filename: string): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
  );
}

export function attach(buffer: Buffer, filename: string): AttachmentBuilder {
  return new AttachmentBuilder(buffer, { name: filename });
}

export function button(
  id: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  emoji?: string,
): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function linkButton(url: string, label: string, emoji?: string): ButtonBuilder {
  const b = new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/** Section = bloc de texte accompagne d'un bouton d'action a droite. */
export function sectionWithButton(md: string, btn: ButtonBuilder): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(text(md))
    .setButtonAccessory(btn);
}

export interface CardOptions {
  accent: string;
  title: string;
  /** Paragraphes de corps, separes visuellement. */
  body?: string[];
  /** Nom de fichier de l'image jointe a afficher dans la carte. */
  image?: string;
  /** Rangees de boutons ajoutees en bas du conteneur. */
  rows?: ActionRowBuilder<ButtonBuilder>[];
  /** Sections texte + bouton. */
  sections?: SectionBuilder[];
  footer?: string;
}

/** Construit un Container V2 complet, pret a etre envoye. */
export function card(opts: CardOptions): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(hexToInt(opts.accent));

  container.addTextDisplayComponents(text(`## ${opts.title}`));

  if (opts.body?.length) {
    container.addSeparatorComponents(separator(false, true));
    for (const paragraph of opts.body) {
      container.addTextDisplayComponents(text(paragraph));
    }
  }

  if (opts.sections?.length) {
    container.addSeparatorComponents(separator(false, true));
    for (const s of opts.sections) container.addSectionComponents(s);
  }

  if (opts.image) {
    container.addSeparatorComponents(separator(true, false));
    container.addMediaGalleryComponents(imageGallery(opts.image));
  }

  if (opts.rows?.length) {
    container.addSeparatorComponents(separator(false, true));
    for (const r of opts.rows) container.addActionRowComponents(r);
  }

  if (opts.footer) {
    container.addSeparatorComponents(separator(false, true));
    container.addTextDisplayComponents(text(`-# ${opts.footer}`));
  }

  return container;
}

/** Enveloppe une carte dans un payload de message complet. */
export function cardMessage(
  container: ContainerBuilder,
  files: AttachmentBuilder[] = [],
): MessageCreateOptions {
  return {
    flags: V2_FLAGS,
    components: [container],
    files,
  };
}

/** Carte d'erreur standardisee. */
export function errorCard(title: string, detail: string): MessageCreateOptions {
  return cardMessage(
    card({
      accent: "#f87171",
      title: `❌ ${title}`,
      body: [detail],
    }),
  );
}

export function infoCard(title: string, detail: string, accent = "#f472b6"): MessageCreateOptions {
  return cardMessage(card({ accent, title, body: [detail] }));
}
