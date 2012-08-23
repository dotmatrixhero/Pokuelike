/*
 * File:   Actor.cpp
 * Author: Brian
 *
 * Created on June 17, 2012, 1:50 AM
 */

#include "Actor.h"

Actor::Actor(int x, int y, int c)
    : Drawable(x, y, c)
{
}

Actor::Actor(int c, TCODColor fore,TCODColor back, bool trans, bool walk)
    : Drawable(c, fore, back, trans, walk)
{
}

Actor::Actor(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, std::string type)
    : Drawable(x, y, c, fore, back, trans, walk, type)
{
}

//Actor::Actor(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, const std::string& name)
 //   : Drawable(x, y, c, fore, back, trans, walk),
 //   name(name)
//{
//}

Actor::~Actor()
{
}

void Actor::draw(TCODConsole* ConsoleMap)
{

    ConsoleMap->putCharEx(x,y,c,fore,ConsoleMap->getCharBackground(x,y));
}

void Actor::setName(const std::string& newname)
{
    name = newname;
}

const std::string Actor::getName() const
{
    return name;
}
