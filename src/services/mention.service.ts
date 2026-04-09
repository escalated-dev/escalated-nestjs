import { Injectable } from '@nestjs/common';

const MENTION_REGEX = /@(\w+(?:\.\w+)*)/g;

@Injectable()
export class MentionService {
  extractMentions(text: string): string[] {
    if (!text) return [];
    const matches = text.matchAll(MENTION_REGEX);
    const usernames = new Set<string>();
    for (const match of matches) usernames.add(match[1]);
    return [...usernames];
  }

  extractUsernameFromEmail(email: string): string {
    if (!email) return '';
    return email.split('@')[0] || email;
  }
}
