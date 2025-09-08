import { NextFunction, Request, Response } from 'express';

export const checkSessionAndSetUser = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.user) {
        return res.status(403).json({message: 'Forbidden'});
    }

    res.locals.user = req.session.user;
    next();
};
