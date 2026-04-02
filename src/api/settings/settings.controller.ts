import { Request, Response } from 'express';
import {systemSettingsRepository} from "@/api/settings/settings.service";
// import userRepository from "@/api/users/users.service";
// import paginationHandler from "@/utils/pagination.util";
// import {ticketMessageRepository, ticketRepository} from "@/api/help/help.service";
// import {Uuid} from "@/common/types/common.type";

export default class SettingsController {
    public async getAiSettingsPage(req: Request, res: Response) {
        const settings = await systemSettingsRepository.findOne({
            where: {
                id: 1,
            }
        })

        res.render('settings-ai', {settings});
    }

    public async saveSettings(req: Request, res: Response) {
        await systemSettingsRepository.update({
            id: 1,
        }, req.body);
        res.json({
            message: 'ok',
        });
    }

}


