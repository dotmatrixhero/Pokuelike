#ifndef RENDERER_H
#define RENDERER_H
#include <libtcod/libtcod.hpp>
#include <SDL/SDL.h>
#include <iostream>
#include <string>
#include <SDL/SDL_ttf.h>

using namespace std;

class Renderer :public ITCODSDLRenderer
{

    public:
        Renderer();
        void render(void *sdlSurface);//, int herox, int heroy);
        virtual ~Renderer();
        void animateSprite();
        void init(int *currentTab, int *TIMER);
    protected:
    private:
        void printMenu(string words, int linesDown, bool erase);
        void clearScreen(SDL_Rect *dst);
        void tabRender();
        SDL_Surface *dst;
        SDL_Surface *sprite1;
        SDL_Surface *sprite2;
        TTF_Font *Font;
        SDL_Surface *message;
        SDL_Surface* blank;
        bool firstRender;
        int* currentTab;
        int* timer;
};

#endif // RENDERER_H
