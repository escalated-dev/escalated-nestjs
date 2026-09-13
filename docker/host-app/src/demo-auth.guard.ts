import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';

/**
 * Demo-only route guards for EscalatedModule's `adminGuard`, `agentGuard` and
 * `customerGuard`. They trust the `demo_user_id` cookie set by the /demo user
 * picker, which is acceptable for a throwaway demo and nowhere else. A real
 * host plugs in its own authentication (session, JWT, passport, ...).
 */
abstract class DemoUserGuard implements CanActivate {
  protected constructor(private readonly users: Repository<User>) {}

  protected abstract admits(user: User): boolean;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = parseInt(req.cookies?.demo_user_id || '0', 10);
    if (!id) return false;

    const user = await this.users.findOne({ where: { id } });
    if (!user || !this.admits(user)) return false;

    req.user = { id: user.id, name: user.name, email: user.email };
    return true;
  }
}

@Injectable()
export class DemoAdminGuard extends DemoUserGuard {
  constructor(@InjectRepository(User) users: Repository<User>) {
    super(users);
  }

  protected admits(user: User): boolean {
    return user.is_admin;
  }
}

@Injectable()
export class DemoAgentGuard extends DemoUserGuard {
  constructor(@InjectRepository(User) users: Repository<User>) {
    super(users);
  }

  protected admits(user: User): boolean {
    return user.is_agent || user.is_admin;
  }
}

@Injectable()
export class DemoCustomerGuard extends DemoUserGuard {
  constructor(@InjectRepository(User) users: Repository<User>) {
    super(users);
  }

  protected admits(): boolean {
    return true;
  }
}
