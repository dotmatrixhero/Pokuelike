#ifndef RENDERER_H
#define RENDERER_H
#include <libtcod/libtcod.hpp>
#include <SDL/SDL.h>


class Renderer :public ITCODSDLRenderer
{
    public:
        Renderer();
        void render(void *sdlSurface, int herox, int heroy);
        virtual ~Renderer();
    protected:
    private:
};

#endif // RENDERER_H
