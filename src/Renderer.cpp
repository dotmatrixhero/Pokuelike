#include "Renderer.h"

Renderer::Renderer()
{
    //ctor
}
void render(void *sdlSurface, int herox, int heroy){
    SDL_Surface *dst = (SDL_Surface *)sdlSurface;
   // SDL_Surface* src = SDL_LoadBMP("kanto sprites.png");
    SDL_Rect *srcRect = new SDL_Rect();
    srcRect->x = 0;
    srcRect->y = 0;
    srcRect->w = 32;
    srcRect->h = 32;
    SDL_Rect *dstRect = new SDL_Rect();
    srcRect->x = herox;
    srcRect->y = heroy;
    srcRect->w = 32;
    srcRect->h = 32;
   // SDL_BlitSurface(src, srcRect, dst, dstRect );

}

Renderer::~Renderer()
{
    //dtor
}
