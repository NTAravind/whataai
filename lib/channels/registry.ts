import type { Channel, ChannelAdapter } from "./channel.interface";
import { whatsappAdapter } from "./whatsapp.adapter";
import { mailAdapter } from "./mail.adapter";

const registry: Record<Channel, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  mail: mailAdapter,
};

export function getAdapter(channel: Channel): ChannelAdapter {
  const adapter = registry[channel];
  if (!adapter) throw new Error(`No channel adapter registered for "${channel}"`);
  return adapter;
}
