import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response } from 'express';

import { User } from './user.entity';

const DEMO_ENV = 'demo';

@Controller()
export class DemoController {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  @Get('/')
  async home(@Res() res: Response) {
    if (process.env.APP_ENV === DEMO_ENV) {
      return res.redirect('/demo');
    }
    return res.status(200).send('Escalated NestJS demo host. Set APP_ENV=demo to enable /demo routes.');
  }

  @Get('/demo')
  async picker(@Res() res: Response) {
    this.guardDemo();
    const all = await this.users.find({ order: { id: 'ASC' } });
    return res.status(200).type('html').send(renderPicker(all));
  }

  @Post('/demo/login/:id')
  async login(@Param('id') id: string, @Res() res: Response) {
    this.guardDemo();
    const user = await this.users.findOne({ where: { id: parseInt(id, 10) } });
    if (!user) throw new NotFoundException('No such demo user.');
    res.cookie('demo_user_id', String(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    const dest = user.is_admin || user.is_agent ? '/escalated/admin/sla/policies' : '/escalated/customer/tickets';
    return res.redirect(302, dest);
  }

  @Post('/demo/logout')
  async logout(@Res() res: Response) {
    this.guardDemo();
    res.clearCookie('demo_user_id');
    return res.redirect('/demo');
  }

  private guardDemo() {
    if (process.env.APP_ENV !== DEMO_ENV) {
      throw new NotFoundException();
    }
  }
}

function renderPicker(users: User[]): string {
  const admins = users.filter((u) => u.is_admin);
  const agents = users.filter((u) => u.is_agent && !u.is_admin);
  const customers = users.filter((u) => !u.is_admin && !u.is_agent);

  const section = (label: string, list: User[], badge: string) => {
    if (!list.length) return '';
    const items = list
      .map(
        (u) => `
        <form method="POST" action="/demo/login/${u.id}">
          <button type="submit" class="user">
            <span>${escapeHtml(u.name)}${badge ? ` <span class="badge ${badge}">${cap(badge)}</span>` : ''}</span>
            <span class="meta">${escapeHtml(u.email)}</span>
          </button>
        </form>`,
      )
      .join('');
    return `<div class="group"><h2>${label}</h2>${items}</div>`;
  };

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Escalated · NestJS Demo</title><style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem}
.wrap{max-width:720px;margin:0 auto}h1{font-size:1.5rem;margin:0 0 .25rem}p.lede{color:#94a3b8;margin:0 0 2rem}
.group{margin-bottom:1.5rem}.group h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:0 0 .5rem}
form{display:block;margin:0}
button.user{display:flex;width:100%;align-items:center;justify-content:space-between;padding:.75rem 1rem;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#f1f5f9;font-size:.95rem;cursor:pointer;margin-bottom:.5rem;text-align:left}
button.user:hover{background:#273549;border-color:#475569}.meta{color:#94a3b8;font-size:.8rem}
.badge{font-size:.7rem;padding:.15rem .5rem;border-radius:999px;background:#334155;color:#cbd5e1;margin-left:.5rem}
.badge.admin{background:#7c3aed;color:#fff}.badge.agent{background:#0ea5e9;color:#fff}
</style></head><body><div class="wrap"><h1>Escalated NestJS Demo</h1><p class="lede">Click a user to log in. Every restart reseeds.</p>
${section('Admins', admins, 'admin')}${section('Agents', agents, 'agent')}${section('Customers', customers, '')}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
