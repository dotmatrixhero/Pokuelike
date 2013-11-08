#include "../include/TitleState.hpp"
#include "../include/StateIdentifiers.hpp"

TitleState::TitleState(StateStack& stateStack)
    : State(stateStack)
{
}


TitleState::~TitleState()
{
}

void TitleState::draw()
{
    TCODConsole::root->print(11, 10, "ELLO LIBTCOD WORLD!");

    int x = 2, y = 15;
    TCODLine::init(x,y,74,37);
    do
    {
        TCODConsole::root->setChar(x, y, 'o');
    } while (!TCODLine::step(&x,&y));
}

bool TitleState::update()
{
    return false;
}

bool TitleState::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
      ;
    else if (key.vk == TCODK_DOWN)
      ;
    else if (key.vk == TCODK_LEFT)
      ;
    else if (key.vk == TCODK_RIGHT)
      ;
    else if (key.c == 'a')
        requestStackPush(States::Debug);
    return false;
}



