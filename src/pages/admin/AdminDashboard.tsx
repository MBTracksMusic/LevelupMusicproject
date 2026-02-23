import { ArrowRight, Inbox, Newspaper, Swords } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardTitle } from '../../components/ui/Card';

export function AdminDashboardPage() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Link to="/admin/news" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-rose-400" />
                  News videos
                </CardTitle>
                <CardDescription className="mt-2">
                  Créer, publier et diffuser les annonces vidéo.
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/battles" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="w-5 h-5 text-rose-400" />
                  Battles
                </CardTitle>
                <CardDescription className="mt-2">
                  Ouvrir la modération battles existante.
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/messages" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="w-5 h-5 text-rose-400" />
                  Messages reçus
                </CardTitle>
                <CardDescription className="mt-2">
                  Lire et traiter les demandes contact/support.
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
