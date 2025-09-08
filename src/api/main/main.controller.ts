import { Request, Response } from 'express';

export default class MainController {
    public async renderMainPage(req: Request, res: Response) {
        res.render('main');
    }
}
