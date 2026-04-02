import { Router } from 'express';
import Controller from './settings.controller';

const setting: Router = Router();
const controller = new Controller();

setting.post('/', controller.saveSettings);
setting.get('/ai', controller.getAiSettingsPage);


export default setting;
