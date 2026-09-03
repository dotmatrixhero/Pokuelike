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
