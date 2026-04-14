import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            authMethod?: 'jwt' | 'api_key';
        }
    }
}
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function generateApiKey(): {
    key: string;
    hash: string;
    prefix: string;
};
//# sourceMappingURL=auth.d.ts.map