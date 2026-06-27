import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiAuthController } from '../../src/controllers/api/auth.controller';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';

describe('ApiAuthController', () => {
  async function build(apiAuth: any): Promise<ApiAuthController> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiAuthController],
      providers: [{ provide: ESCALATED_OPTIONS, useValue: { apiAuth } }],
    }).compile();
    return module.get<ApiAuthController>(ApiAuthController);
  }

  it('login delegates to the host callback', async () => {
    const authenticate = jest.fn().mockResolvedValue({ token: 'abc', email: 'a@b.com' });
    const controller = await build({ authenticate });

    expect(await controller.login({ email: 'a@b.com' })).toEqual({
      data: { token: 'abc', email: 'a@b.com' },
    });
    expect(authenticate).toHaveBeenCalledWith({ email: 'a@b.com' });
  });

  it('responds 501 when the callback is not configured', async () => {
    const controller = await build({});
    await expect(controller.login({})).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('responds 401 when the callback returns null', async () => {
    const controller = await build({ authenticate: jest.fn().mockResolvedValue(null) });
    await expect(controller.login({})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('me reads the bearer token and returns the user', async () => {
    const validate = jest.fn().mockResolvedValue({ id: 7 });
    const controller = await build({ validate });

    expect(await controller.me('Bearer tok123')).toEqual({ data: { id: 7 } });
    expect(validate).toHaveBeenCalledWith('tok123');
  });

  it('validate requires a token, then returns valid + user', async () => {
    const controller = await build({ validate: jest.fn().mockResolvedValue({ id: 1 }) });

    await expect(controller.validate(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(await controller.validate('tok')).toEqual({ valid: true, user: { id: 1 } });
  });

  it('logout always succeeds and forwards the token', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    const controller = await build({ logout });

    expect(await controller.logout('Bearer x')).toEqual({ data: { success: true } });
    expect(logout).toHaveBeenCalledWith('x');
  });

  it('logout succeeds even with no callback', async () => {
    const controller = await build({});
    expect(await controller.logout()).toEqual({ data: { success: true } });
  });
});
