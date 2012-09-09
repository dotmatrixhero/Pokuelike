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

        void init(int *currentTab);
    protected:
    private:
        void printMenu(string words, int linesDown, bool erase);
        void clearScreen(SDL_Rect *dst);
        void tabRender();
        SDL_Surface *dst;
        TTF_Font *Font;
        SDL_Surface *message;
        int* currentTab;
};

#endif // RENDERER_H
