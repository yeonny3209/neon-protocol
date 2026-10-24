import './ui/styles/base.css';
import './ui/styles/battle.css';
import { watchOrient } from './ui/layout';
import { showProto } from './ui/proto';

watchOrient();
const root = document.getElementById('app')!;
showProto(root);
